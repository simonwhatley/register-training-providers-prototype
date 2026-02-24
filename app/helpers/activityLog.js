const { Op } = require('sequelize')
const {
  ActivityLog,
  Provider,
  ProviderAccreditation,
  ProviderAccreditationRevision,
  ProviderAddress,
  ProviderAddressRevision,
  ProviderContact,
  ProviderContactRevision,
  ProviderRevision,
  ProviderAcademicYear,
  ProviderPartnership,
  ProviderPartnershipAcademicYear,
  ProviderPartnershipRevision,
  ProviderAcademicYearRevision,
  ApiClientToken,
  ApiClientTokenRevision,
  User,
  UserRevision,
  AcademicYear,
  AcademicYearRevision
} = require('../models')

const { govukDate, isToday, isYesterday } = require('./date')
const { getProviderTypeLabel } = require('./content')
const { appendSection } = require('./string')
const EXCLUDED_REVISION_TABLES = ['provider_partnership_academic_year_revisions']

const getCurrentAcademicYearStart = (now = new Date(), timeZone = 'Europe/London') => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: 'numeric', day: 'numeric'
  }).formatToParts(now)
  const y = Number(parts.find(p => p.type === 'year').value)
  const m = Number(parts.find(p => p.type === 'month').value) // 1–12
  const d = Number(parts.find(p => p.type === 'day').value)
  // If on/after 1 Aug => current AY starts this calendar year; else previous year
  return (m > 8 || (m === 8 && d >= 1)) ? y : (y - 1)
}

const getAcademicYearStatusLabel = (academicYear, currentAcademicYearStart = getCurrentAcademicYearStart()) => {
  if (!academicYear || !academicYear.startsOn) {
    return null
  }

  const startDate = new Date(academicYear.startsOn)
  if (Number.isNaN(startDate.getTime())) {
    return null
  }

  const startYear = startDate.getUTCFullYear()

  if (startYear === currentAcademicYearStart) {
    return 'current'
  }

  if (startYear === currentAcademicYearStart - 1) {
    return 'last'
  }

  if (startYear === currentAcademicYearStart + 1) {
    return 'next'
  }

  return null
}

/**
 * Maps revision table names to their associated include alias.
 * @type {Object.<string, string>}
 */
const revisionAssociationMap = {
  provider_revisions: 'providerRevision',
  provider_accreditation_revisions: 'providerAccreditationRevision',
  provider_address_revisions: 'providerAddressRevision',
  provider_contact_revisions: 'providerContactRevision',
  provider_partnership_revisions: 'providerPartnershipRevision',
  provider_academic_year_revisions: 'providerAcademicYearRevision',
  api_client_token_revisions: 'apiClientTokenRevision',
  user_revisions: 'userRevision',
  academic_year_revisions: 'academicYearRevision'
}

/**
 * Maps revision table names to their Sequelize model.
 * @type {Object.<string, import('sequelize').Model>}
 */
const revisionModels = {
  provider_revisions: ProviderRevision,
  provider_accreditation_revisions: ProviderAccreditationRevision,
  provider_address_revisions: ProviderAddressRevision,
  provider_contact_revisions: ProviderContactRevision,
  provider_partnership_revisions: ProviderPartnershipRevision,
  provider_academic_year_revisions: ProviderAcademicYearRevision,
  api_client_token_revisions: ApiClientTokenRevision,
  user_revisions: UserRevision,
  academic_year_revisions: AcademicYearRevision
}

/**
 * Returns the Sequelize model for the given revision table.
 *
 * @param {string} revisionTable - Name of the revision table (e.g. 'provider_revisions').
 * @returns {import('sequelize').Model} The associated Sequelize model.
 */
const getRevisionModel = (revisionTable) => revisionModels[revisionTable]

/**
 * Collapse duplicate provider academic year activity logs that were created
 * as part of the same change (e.g. selecting multiple academic years at once).
 *
 * We keep only the first entry for each (provider, changedAt, changedById, action)
 * combination because the summary already lists all academic years for the provider.
 *
 * @param {import('sequelize').Model[]} logs
 * @returns {import('sequelize').Model[]} Collapsed logs.
 */
const collapseProviderAcademicYearLogs = (logs) => {
  const seen = new Set()
  const collapsed = []

  for (const log of logs) {
    if (log.revisionTable !== 'provider_academic_year_revisions') {
      collapsed.push(log)
      continue
    }

    const providerId =
      log.providerAcademicYearRevision?.providerId ||
      log.providerAcademicYearRevision?.provider_id ||
      log.revision?.providerId

    if (!providerId) {
      collapsed.push(log)
      continue
    }

    const changedAtKey = log.changedAt ? new Date(log.changedAt).toISOString() : 'unknown'
    const key = [
      log.revisionTable,
      providerId,
      log.changedById || '',
      changedAtKey
    ].join('|')

    if (seen.has(key)) continue
    seen.add(key)
    collapsed.push(log)
  }

  return collapsed
}

/**
 * Normalise an action into the activity verb we display.
 *
 * @param {string} action - The raw log action (e.g. 'create', 'update', 'delete').
 * @returns {string} The verb to use in activity labels (e.g. 'added').
 */
const getActivityVerb = (action) => {
  const verbs = {
    create: 'added',
    update: 'updated',
    delete: 'deleted'
  }
  return verbs[action] || `${action}d`
}

/**
 * Safely escape a string for inclusion in HTML by replacing the five
 * special characters `&`, `<`, `>`, `"` and `'` with their entity forms.
 *
 * This is useful when rendering untrusted text into HTML to prevent
 * injection/XSS via text nodes or attribute values.
 *
 * Note:
 * - This function **does not** decode entities.
 * - It assumes plain text input; if you pass already-escaped HTML,
 *   it will escape the ampersands again (idempotent for safe text usage).
 *
 * @param {string} [s=''] - The input string to escape. `null`/`undefined` are coerced to `''`.
 * @returns {string} The escaped HTML-safe string.
 *
 * @example
 * escapeHtml(`<a href="?q=tea & biscuits">"Click"</a>`);
 * // "&lt;a href=&quot;?q=tea &amp; biscuits&quot;&gt;&quot;Click&quot;&lt;/a&gt;"
 */
const escapeHtml = (s = '') =>
  String(s)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#39;')

/**
 * Decide whether a provider should be linkable (listed) in the register UI.
 *
 * A provider is considered "listable" only if it has not been soft-deleted
 * and is not archived. Extend this predicate if you have additional gating
 * flags (e.g. `isActive`).
 *
 * @param {import('../models').Provider | null | undefined} provider
 *   A Sequelize Provider instance fetched with `{ paranoid: false }`, or null/undefined.
 * @returns {boolean}
 *   `true` if the provider is currently listable (safe to link to), otherwise `false`.
 *
 * @example
 * const provider = await Provider.findByPk(id, { paranoid: false });
 * if (isProviderListable(provider)) {
 *   // render link
 * } else {
 *   // render plain text
 * }
 */
const isProviderListable = (provider) =>
  provider && provider.deletedAt == null // && provider.archivedAt == null

/**
 * Build a safe API client link (or plain text) depending on its current state.
 * @param {string} apiClientTokenId
 * @param {string} fallbackName
 * @returns {Promise<{text:string, href:string, html?:string}>}
 */
const buildApiClientTokenLink = async (apiClientTokenId, fallbackName = 'API client') => {
  if (!apiClientTokenId) {
    const safeText = escapeHtml(fallbackName)
    return { text: fallbackName, href: '', html: safeText }
  }

  const token = await ApiClientToken.findByPk(apiClientTokenId, { paranoid: false })
  const text = token?.clientName || fallbackName

  // Do not link deleted tokens
  if (!token || token.deletedAt) {
    return { text, href: '', html: escapeHtml(text) }
  }

  const href = `/api-clients/${apiClientTokenId}`
  return {
    text,
    href,
    html: `<a class="govuk-link" href="${href}">${escapeHtml(text)}</a>`
  }
}

/**
 * Build a safe provider link (or plain text) depending on its current listable state.
 *
 * This helper:
 *  - Looks up the provider with `{ paranoid: false }` so soft-deleted rows are visible.
 *  - Returns a *link* only if the provider passes `isProviderListable`.
 *  - Falls back to plain text (no link) when the provider is missing or not listable.
 *
 * @async
 * @param {string | null | undefined} providerId
 *   The provider's UUID (or undefined/null). If falsy, the function uses the fallback name.
 * @param {string | null | undefined} fallbackName
 *   A label to use if the provider name can't be resolved (e.g. from the log payload).
 * @returns {Promise<{text: string, href: string, html: string}>}
 *   - `text`: The chosen display name (resolved from provider or `fallbackName`).
 *   - `href`: The canonical provider URL (empty string if not listable).
 *   - `html`: A safe HTML string (linked when listable, escaped plain text otherwise).
 *
 * @example
 * const { text, href, html } = await buildProviderLink(revision.providerId, revision.operatingName);
 * // Use `text` for non-HTML contexts, `html` for inline rich rendering, and `href` for tables.
 *
 * @example
 * // Composing a section-specific link when listable:
 * const { href } = await buildProviderLink(revision.providerId, 'Provider');
 * const contactsHref = href ? `${href}/contacts` : ''; // empty string when not listable
 */
const buildProviderLink = async (providerId, fallbackName) => {
  if (!providerId) return { text: fallbackName || 'Provider', href: '', html: escapeHtml(fallbackName || 'Provider') }

  const provider = await Provider.findByPk(providerId, {
    paranoid: false,
    attributes: ['id', 'operatingName', 'legalName', 'deletedAt', 'archivedAt']
  })

  const text = provider?.operatingName || provider?.legalName || fallbackName || 'Provider'
  const href = isProviderListable(provider) ? `/providers/${provider.id}` : ''
  const html = href ? `<a class="govuk-link" href="${href}">${escapeHtml(text)}</a>` : escapeHtml(text)
  return { text, href, html }
}

/**
 * Decide whether a user should be linkable (listed) in the UI.
 *
 * A user is considered "listable" only if they have not been soft-deleted
 * (i.e. `deletedAt == null`). If you also require an active flag, the check
 * includes `isActive !== false`. Adjust this predicate to your needs.
 *
 * @param {import('../models').User | null | undefined} user
 *   A Sequelize User instance fetched with `{ paranoid: false }`, or null/undefined.
 * @returns {boolean}
 *   `true` if the user is currently listable (safe to link to), otherwise `false`.
 *
 * @example
 * const user = await User.findByPk(id, { paranoid: false });
 * if (isUserListable(user)) {
 *   // render link
 * } else {
 *   // render plain text
 * }
 */
const isUserListable = (user) =>
  !!user && user.deletedAt == null && user.isActive !== false

/**
 * Build a safe user link (or plain text) depending on current listable state.
 *
 * This helper:
 *  - Looks up the user with `{ paranoid: false }` so soft-deleted rows are visible.
 *  - Returns a *link* only if the user passes `isUserListable`.
 *  - Falls back to plain text (no link) when the user is missing or not listable.
 *
 * @async
 * @param {string | null | undefined} userId
 *   The user's UUID (or undefined/null). If falsy, the function uses the fallback name.
 * @param {string | null | undefined} [fallbackName]
 *   A label to use if the user’s name can't be resolved (e.g. from the log payload).
 * @returns {Promise<{text: string, href: string, html: string}>}
 *   - `text`: The chosen display name (resolved from user or `fallbackName`).
 *   - `href`: The canonical user URL (empty string if not listable).
 *   - `html`: A safe HTML string (linked when listable, escaped plain text otherwise).
 *
 * @example
 * const { text, href, html } = await buildUserLink(log.changedById, 'Unknown user');
 * // Use `text` for non-HTML contexts, `html` for inline rendering, and `href` for tables.
 *
 * @example
 * // Composing a section-specific link when listable:
 * const { href } = await buildUserLink(log.changedById, 'User');
 * const activityHref = href ? `${href}/activity` : ''; // empty string when not listable
 */
const buildUserLink = async (userId, fallbackName) => {
  if (!userId) {
    const text = fallbackName || 'User'
    return { text, href: '', html: escapeHtml(text) }
  }

  const user = await User.findByPk(userId, {
    paranoid: false,
    attributes: ['id', 'firstName', 'lastName', 'email', 'deletedAt', 'isActive']
  })

  // Prefer a proper name; fall back to email; then to the provided fallback.
  const derivedName = user
    ? [user.firstName, user.lastName].filter(Boolean).join(' ').trim()
    : ''
  const text = derivedName || user?.email || fallbackName || 'User'

  // TODO: If your route isn’t `/users/:id`, change the href here.
  const href = isUserListable(user) ? `/users/${user.id}` : ''
  const html = href
    ? `<a class="govuk-link" href="${href}">${escapeHtml(text)}</a>`
    : escapeHtml(text)

  return { text, href, html }
}

/**
 * Decide whether an academic year should be linkable (listed) in the UI.
 *
 * An academic year is considered "listable" only if they have not been soft-deleted
 * (i.e. `deletedAt == null`). If you also require an active flag, the check
 * includes `isActive !== false`. Adjust this predicate to your needs.
 *
 * @param {import('../models').AcademicYear | null | undefined} academicYear
 *   A Sequelize Academic Year instance fetched with `{ paranoid: false }`, or null/undefined.
 * @returns {boolean}
 *   `true` if the academic year is currently listable (safe to link to), otherwise `false`.
 *
 * @example
 * const academicYear = await AcademicYear.findByPk(id, { paranoid: false });
 * if (isAcademicYearListable(academicYear)) {
 *   // render link
 * } else {
 *   // render plain text
 * }
 */
const isAcademicYearListable = (academicYear) =>
  !!academicYear && academicYear.deletedAt == null

/**
 * Build a safe academic year link (or plain text) depending on current listable state.
 *
 * This helper:
 *  - Looks up the academic year with `{ paranoid: false }` so soft-deleted rows are visible.
 *  - Returns a *link* only if the academic year passes `isAcademicYearListable`.
 *  - Falls back to plain text (no link) when the academic year is missing or not listable.
 *
 * @async
 * @param {string | null | undefined} academicYearId
 *   The academic year's UUID (or undefined/null). If falsy, the function uses the fallback name.
 * @param {string | null | undefined} [fallbackName]
 *   A label to use if the academic year’s name can't be resolved (e.g. from the log payload).
 * @returns {Promise<{text: string, href: string, html: string}>}
 *   - `text`: The chosen display name (resolved from academic year or `fallbackName`).
 *   - `href`: The canonical academic year URL (empty string if not listable).
 *   - `html`: A safe HTML string (linked when listable, escaped plain text otherwise).
 *
 * @example
 * const { text, href, html } = await buildAcademicYearLink(log.academicYearId, 'Unknown academic year');
 * // Use `text` for non-HTML contexts, `html` for inline rendering, and `href` for tables.
 *
 * @example
 * // Composing a section-specific link when listable:
 * const { href } = await buildAcademicYearLink(log.academicYearId, 'Academic year');
 * const activityHref = href ? `${href}/activity` : ''; // empty string when not listable
 */
const buildAcademicYearLink = async (academicYearId, fallbackName) => {
  if (!academicYearId) {
    const text = fallbackName || 'Academic year'
    return { text, href: '', html: escapeHtml(text) }
  }

  const academicYear = await AcademicYear.findByPk(academicYearId, {
    paranoid: false,
    attributes: ['id', 'code', 'name', 'deletedAt']
  })

  // Prefer a name; fall back to code; then to the provided fallback.
  const derivedName = academicYear
    ? academicYear.name
    : ''
  const text = derivedName || academicYear?.code || fallbackName || 'Academic year'

  // TODO: If your route isn’t `/academic-years/:id`, change the href here.
  const href = isAcademicYearListable(academicYear) ? `/settings/academic-years/${academicYear.id}` : ''
  const html = href
    ? `<a class="govuk-link" href="${href}">${escapeHtml(text)}</a>`
    : escapeHtml(text)

  return { text, href, html }
}

/**
 * Returns the foreign key(s) used by the revision table for previous/latest lookups.
 *
 * NOTE: For partnership *revision* tables, the entity is the partnership itself,
 * so we use `providerPartnershipId`. For academic-year link revisions, we use
 * `providerPartnershipAcademicYearId`.
 *
 * @param {string} revisionTable - Name of the revision table.
 * @returns {string[]} Array of foreign key fields.
 */
const getEntityKeys = (revisionTable) => {
  switch (revisionTable) {
    case 'user_revisions':
      return ['userId']
    case 'academic_year_revisions':
      return ['academicYearId']
    case 'provider_partnership_revisions':
      return ['providerPartnershipId']
    case 'provider_academic_year_revisions':
      return ['providerAcademicYearId']
    case 'api_client_token_revisions':
      return ['apiClientTokenId']
    default:
      return ['providerId']
  }
}

/**
 * Formats a raw ActivityLog instance by attaching its revision and generating a summary.
 *
 * @async
 * @param {import('sequelize').Model} log - A Sequelize ActivityLog instance with includes.
 * @returns {Promise<Object>} A plain object including `revision` and `summary` fields.
 */
const formatActivityLog = async (log) => {
  try {
    const logJson = log.toJSON()
    const alias = revisionAssociationMap[log.revisionTable]
    const revision = log[alias] || null
    logJson.revision = revision ? (revision.toJSON?.() || revision) : null
    logJson.summary = await getRevisionSummary({
      revision: logJson.revision,
      revisionTable: log.revisionTable,
      ...logJson
    })
    return logJson
  } catch (err) {
    console.error(`Error processing activity log ${log.id}:`, err)
    return {
      ...log.toJSON(),
      revision: null,
      summary: {
        label: 'Error loading revision',
        fields: []
      }
    }
  }
}

/**
 * Fetches all activity logs, optionally filtered by entity ID, and formats them.
 *
 * @async
 * @param {Object} options
 * @param {string|null} [options.entityId] - Optional ID of the entity to filter logs.
 * @param {number} [options.limit=25] - Maximum number of logs to return.
 * @param {number} [options.offset=0] - Number of logs to skip (for pagination).
 * @returns {Promise<Object[]>} Array of formatted activity log entries.
 */
const getActivityLogs = async ({ entityId = null, limit = 25, offset = 0 }) => {
  const whereClause = entityId ? { entityId } : {}
  whereClause.revisionTable = { [Op.notIn]: EXCLUDED_REVISION_TABLES }

  const activityLogs = await ActivityLog.findAll({
    where: whereClause,
    include: [
      {
        model: ProviderRevision,
        as: 'providerRevision',
        include: [{ model: Provider, as: 'provider' }]
      },
      {
        model: ProviderAccreditationRevision,
        as: 'providerAccreditationRevision',
        include: [{ model: Provider, as: 'provider' }]
      },
      {
        model: ProviderAddressRevision,
        as: 'providerAddressRevision',
        include: [{ model: Provider, as: 'provider' }]
      },
      {
        model: ProviderContactRevision,
        as: 'providerContactRevision',
        include: [{ model: Provider, as: 'provider' }]
      },
      {
        model: ProviderPartnershipRevision,
        as: 'providerPartnershipRevision',
        include: [
          { model: Provider, as: 'accreditedProvider' },
          { model: Provider, as: 'trainingPartner' }
        ]
      },
      {
        model: ProviderAcademicYearRevision,
        as: 'providerAcademicYearRevision',
        include: [
          { model: Provider, as: 'provider' },
          { model: AcademicYear, as: 'academicYear' }
        ]
      },
      {
        model: UserRevision,
        as: 'userRevision'
      },
      {
        model: AcademicYearRevision,
        as: 'academicYearRevision'
      },
      {
        model: ApiClientTokenRevision,
        as: 'apiClientTokenRevision'
      },
      {
        model: User,
        as: 'changedByUser'
      }
    ],
    order: [['changedAt', 'DESC'], ['id', 'DESC']],
    limit,
    offset
  })

  return Promise.all(collapseProviderAcademicYearLogs(activityLogs).map(formatActivityLog))
}

/**
 * Returns the total number of activity logs after collapsing provider academic year entries.
 *
 * @async
 * @returns {Promise<number>} Total number of logs.
 */
const getActivityTotalCount = async () => {
  const activityLogs = await ActivityLog.findAll({
    where: {
      revisionTable: { [Op.notIn]: EXCLUDED_REVISION_TABLES }
    },
    attributes: ['id', 'revisionTable', 'changedAt', 'changedById', 'action'],
    include: [
      {
        model: ProviderAcademicYearRevision,
        as: 'providerAcademicYearRevision',
        required: false,
        attributes: ['providerId']
      }
    ]
  })

  return collapseProviderAcademicYearLogs(activityLogs).length
}

/**
 * Fetches activity logs related to a specific provider across all relevant revision tables.
 *
 * Optimized to use two database queries instead of 5 separate queries.
 * First query gets all relevant activity log IDs, second query fetches full data with associations.
 *
 * @async
 * @param {Object} options
 * @param {string} options.providerId - The ID of the provider.
 * @param {number} [options.limit=25] - Maximum number of logs to return.
 * @param {number} [options.offset=0] - Number of logs to skip (for pagination).
 * @returns {Promise<Object[]>} Array of formatted activity log entries.
 */
const getProviderActivityLogs = async ({ providerId, limit = 25, offset = 0 }) => {
  if (!providerId) throw new Error('providerId is required')

  // Step 1: Get the IDs of matching activity logs using a lightweight query
  const matchingLogIds = await ActivityLog.findAll({
    attributes: ['id', 'changedAt'],
    where: {
      [Op.or]: [
        // Provider revisions
        {
          revisionTable: 'provider_revisions',
          '$providerRevision.provider_id$': providerId
        },
        // Accreditation revisions
        {
          revisionTable: 'provider_accreditation_revisions',
          '$providerAccreditationRevision.provider_id$': providerId
        },
        // Address revisions
        {
          revisionTable: 'provider_address_revisions',
          '$providerAddressRevision.provider_id$': providerId
        },
        // Contact revisions
        {
          revisionTable: 'provider_contact_revisions',
          '$providerContactRevision.provider_id$': providerId
        },
        // Partnership revisions
        {
          revisionTable: 'provider_partnership_revisions',
          [Op.or]: [
            { '$providerPartnershipRevision.accredited_provider_id$': providerId },
            { '$providerPartnershipRevision.training_partner_id$': providerId }
          ]
        },
        // Provider academic year revisions
        {
          revisionTable: 'provider_academic_year_revisions',
          '$providerAcademicYearRevision.provider_id$': providerId
        }
      ]
    },
    include: [
      {
        model: ProviderRevision,
        as: 'providerRevision',
        attributes: [],
        required: false
      },
      {
        model: ProviderAccreditationRevision,
        as: 'providerAccreditationRevision',
        attributes: [],
        required: false
      },
      {
        model: ProviderAddressRevision,
        as: 'providerAddressRevision',
        attributes: [],
        required: false
      },
      {
        model: ProviderContactRevision,
        as: 'providerContactRevision',
        attributes: [],
        required: false
      },
      {
        model: ProviderPartnershipRevision,
        as: 'providerPartnershipRevision',
        attributes: [],
        required: false
      },
      {
        model: ProviderAcademicYearRevision,
        as: 'providerAcademicYearRevision',
        attributes: [],
        required: false
      }
    ],
    order: [['changedAt', 'DESC'], ['id', 'DESC']],
    limit,
    offset,
    subQuery: false,
    raw: true
  })

  // If no logs found, return empty array
  if (matchingLogIds.length === 0) {
    return []
  }

  const ids = matchingLogIds.map(log => log.id)

  // Step 2: Fetch full activity logs with all associations for the matched IDs
  const activityLogs = await ActivityLog.findAll({
    where: {
      id: { [Op.in]: ids }
    },
    include: [
      {
        model: ProviderRevision,
        as: 'providerRevision',
        required: false,
        include: [{ model: Provider, as: 'provider' }]
      },
      {
        model: ProviderAccreditationRevision,
        as: 'providerAccreditationRevision',
        required: false,
        include: [{ model: Provider, as: 'provider' }]
      },
      {
        model: ProviderAddressRevision,
        as: 'providerAddressRevision',
        required: false,
        include: [{ model: Provider, as: 'provider' }]
      },
      {
        model: ProviderContactRevision,
        as: 'providerContactRevision',
        required: false,
        include: [{ model: Provider, as: 'provider' }]
      },
      {
        model: ProviderPartnershipRevision,
        as: 'providerPartnershipRevision',
        required: false,
        include: [
          { model: Provider, as: 'accreditedProvider' },
          { model: Provider, as: 'trainingPartner' }
        ]
      },
      {
        model: ProviderAcademicYearRevision,
        as: 'providerAcademicYearRevision',
        required: false,
        include: [
          { model: Provider, as: 'provider' },
          { model: AcademicYear, as: 'academicYear' }
        ]
      },
      {
        model: User,
        as: 'changedByUser'
      },
      {
        model: AcademicYearRevision,
        as: 'academicYearRevision',
        required: false
      }
    ],
    order: [['changedAt', 'DESC'], ['id', 'DESC']]
  })

  return Promise.all(collapseProviderAcademicYearLogs(activityLogs).map(formatActivityLog))
}

/**
 * Returns the total count of activity logs for a specific provider across all revision types.
 *
 * Optimized to use a single database query instead of 5 separate queries.
 *
 * @async
 * @param {Object} options
 * @param {string} options.providerId - The provider ID to count activity for.
 * @returns {Promise<number>} Total count of logs.
 */
const getProviderActivityTotalCount = async ({ providerId }) => {
  if (!providerId) throw new Error('providerId is required')

  // Single optimized query matching the same WHERE logic as getProviderActivityLogs
  const activityLogs = await ActivityLog.findAll({
    where: {
      [Op.or]: [
        {
          revisionTable: 'provider_revisions',
          '$providerRevision.provider_id$': providerId
        },
        {
          revisionTable: 'provider_accreditation_revisions',
          '$providerAccreditationRevision.provider_id$': providerId
        },
        {
          revisionTable: 'provider_address_revisions',
          '$providerAddressRevision.provider_id$': providerId
        },
        {
          revisionTable: 'provider_contact_revisions',
          '$providerContactRevision.provider_id$': providerId
        },
        {
          revisionTable: 'provider_partnership_revisions',
          [Op.or]: [
            { '$providerPartnershipRevision.accredited_provider_id$': providerId },
            { '$providerPartnershipRevision.training_partner_id$': providerId }
          ]
        },
        {
          revisionTable: 'provider_academic_year_revisions',
          '$providerAcademicYearRevision.provider_id$': providerId
        }
      ]
    },
    attributes: ['id', 'revisionTable', 'changedAt', 'changedById', 'action'],
    include: [
      {
        model: ProviderRevision,
        as: 'providerRevision',
        required: false,
        attributes: []
      },
      {
        model: ProviderAccreditationRevision,
        as: 'providerAccreditationRevision',
        required: false,
        attributes: []
      },
      {
        model: ProviderAddressRevision,
        as: 'providerAddressRevision',
        required: false,
        attributes: []
      },
      {
        model: ProviderContactRevision,
        as: 'providerContactRevision',
        required: false,
        attributes: []
      },
      {
        model: ProviderPartnershipRevision,
        as: 'providerPartnershipRevision',
        required: false,
        attributes: []
      },
      {
        model: ProviderAcademicYearRevision,
        as: 'providerAcademicYearRevision',
        required: false,
        attributes: ['providerId']
      }
    ],
    subQuery: false
  })

  return collapseProviderAcademicYearLogs(activityLogs).length
}

/**
 * Fetches all activity logs made by a specific user, optionally filtered by revision table(s).
 *
 * @async
 * @param {Object} options
 * @param {string} options.userId - ID of the user who made the changes.
 * @param {string|string[]|null} [options.revisionTable] - Optional table(s) to filter by.
 * @param {number} [options.limit=25] - Maximum number of logs to return.
 * @param {number} [options.offset=0] - Number of logs to skip (for pagination).
 * @returns {Promise<Object[]>} Array of formatted activity logs.
 */
const getUserActivityLogs = async ({ userId, revisionTable = null, limit = 25, offset = 0 }) => {
  if (!userId) throw new Error('userId is required')

  const whereClause = { changedById: userId }
  if (revisionTable) {
    whereClause.revisionTable = Array.isArray(revisionTable) ? { [Op.in]: revisionTable } : revisionTable
  } else {
    whereClause.revisionTable = { [Op.notIn]: EXCLUDED_REVISION_TABLES }
  }

  const activityLogs = await ActivityLog.findAll({
    where: whereClause,
    include: [
      {
        model: ProviderRevision,
        as: 'providerRevision',
        include: [{ model: Provider, as: 'provider' }]
      },
      {
        model: ProviderAccreditationRevision,
        as: 'providerAccreditationRevision',
        include: [{ model: Provider, as: 'provider' }]
      },
      {
        model: ProviderAddressRevision,
        as: 'providerAddressRevision',
        include: [{ model: Provider, as: 'provider' }]
      },
      {
        model: ProviderContactRevision,
        as: 'providerContactRevision',
        include: [{ model: Provider, as: 'provider' }]
      },
      {
        model: ProviderPartnershipRevision,
        as: 'providerPartnershipRevision',
        include: [
          { model: Provider, as: 'accreditedProvider' },
          { model: Provider, as: 'trainingPartner' }
        ]
      },
      {
        model: ProviderAcademicYearRevision,
        as: 'providerAcademicYearRevision',
        include: [
          { model: Provider, as: 'provider' },
          { model: AcademicYear, as: 'academicYear' }
        ]
      },
      {
        model: UserRevision,
        as: 'userRevision'
      },
      {
        model: AcademicYearRevision,
        as: 'academicYearRevision'
      },
      {
        model: User,
        as: 'changedByUser'
      }
    ],
    order: [['changedAt', 'DESC'], ['id', 'DESC']],
    limit,
    offset
  })

  return Promise.all(collapseProviderAcademicYearLogs(activityLogs).map(formatActivityLog))
}

/**
 * Returns the total number of activity logs created by a user, optionally filtered by revision table(s).
 *
 * @async
 * @param {Object} options
 * @param {string} options.userId - ID of the user.
 * @param {string|string[]|null} [options.revisionTable] - Optional table(s) to filter by.
 * @returns {Promise<number>} Total number of logs.
 */
const getUserActivityTotalCount = async ({ userId, revisionTable = null }) => {
  if (!userId) throw new Error('userId is required')

  const whereClause = { changedById: userId }
  if (revisionTable) {
    whereClause.revisionTable = Array.isArray(revisionTable) ? { [Op.in]: revisionTable } : revisionTable
  } else {
    whereClause.revisionTable = { [Op.notIn]: EXCLUDED_REVISION_TABLES }
  }

  const activityLogs = await ActivityLog.findAll({
    where: whereClause,
    attributes: ['id', 'revisionTable', 'changedAt', 'changedById', 'action'],
    include: [
      {
        model: ProviderRevision,
        as: 'providerRevision',
        required: false,
        include: [{ model: Provider, as: 'provider' }]
      },
      {
        model: ProviderAccreditationRevision,
        as: 'providerAccreditationRevision',
        required: false,
        include: [{ model: Provider, as: 'provider' }]
      },
      {
        model: ProviderAddressRevision,
        as: 'providerAddressRevision',
        required: false,
        include: [{ model: Provider, as: 'provider' }]
      },
      {
        model: ProviderContactRevision,
        as: 'providerContactRevision',
        required: false,
        include: [{ model: Provider, as: 'provider' }]
      },
      {
        model: ProviderPartnershipRevision,
        as: 'providerPartnershipRevision',
        required: false,
        include: [
          { model: Provider, as: 'accreditedProvider' },
          { model: Provider, as: 'trainingPartner' }
        ]
      },
      {
        model: ProviderAcademicYearRevision,
        as: 'providerAcademicYearRevision',
        required: false,
        include: [
          { model: Provider, as: 'provider' },
          { model: AcademicYear, as: 'academicYear' }
        ]
      },
      {
        model: UserRevision,
        as: 'userRevision',
        required: false
      },
      {
        model: AcademicYearRevision,
        as: 'academicYearRevision',
        required: false
      }
    ]
  })

  return collapseProviderAcademicYearLogs(activityLogs).length
}

/**
 * Builds a structured summary for a given revision, including activity label, link and changed fields.
 *
 * @async
 * @param {Object} options
 * @param {Object|null} options.revision - The revision object.
 * @param {string} options.revisionTable - Name of the revision table.
 * @param {string} options.action - Type of action (e.g. 'create', 'update', 'delete').
 * @param {string} options.revisionId - ID of the revision.
 * @param {string} options.entityId - ID of the provider or user (or partnership for partnership logs).
 * @returns {Promise<{
 *   action: string,
 *   activity: string,
 *   label: string,
 *   href: string,
 *   fields: Array<{ key: string, value: string, href?: string }>,
 *   // extra, case-specific structured data for views/partials:
 *   links?: { accreditedProvider?: string, trainingPartner?: string },
 *   labelHtml?: string,
 *   // partnership case only:
 *   linkedAcademicYears?: Array<{ id: string, name: string, startsOn: string|null, endsOn: string|null }>,
 *   academicYearsAdded?: Array<{ id: string, name: string, startsOn: string|null, endsOn: string|null }>,
 *   academicYearsRemoved?: Array<{ id: string, name: string, startsOn: string|null, endsOn: string|null }>,
 *   parties?: {
 *     accredited: { text: string, href: string, html: string },
 *     training:   { text: string, href: string, html: string }
 *   }
 * }>}
 */
const getRevisionSummary = async ({ revision, revisionTable, ...log }) => {
  if (!revision) {
    return {
      action: log.action || '',
      activity: '',
      label: 'Revision details unavailable',
      href: '',
      fields: []
    }
  }

  const action = log.action
  let activity = ''
  let label = ''
  let href = ''
  const fields = []

  // OPTIONAL extras (only set in certain cases)
  let labelHtml = ''
  let linkedAcademicYears = []
  let previousLinkedAcademicYears = []
  let summaryLinkedAcademicYears = []
  let academicYearsAdded = []
  let academicYearsRemoved = []
  let partnershipDatesSummary = null
  let accreditationDatesSummary = null

  switch (revisionTable) {
    case 'provider_revisions': {
      const previousRevision = await getPreviousRevision({
        revisionTable,
        revisionId: log.revisionId,
        entityId: log.entityId
      })

      if (log.action === 'update') {
        if (revision.archivedAt) {
          activity = 'Provider archived'
        } else if (previousRevision?.archivedAt) {
          activity = 'Provider restored'
        } else {
          activity = 'Provider updated'
        }
      } else {
        const actionLabel = getActivityVerb(log.action)
        activity = `Provider ${actionLabel}`
      }

      const { text, href: safeHref } = await buildProviderLink(revision.providerId, revision.operatingName || revision.name)
      label = text
      href = safeHref

      fields.push({ key: 'Provider type', value: getProviderTypeLabel(revision.type) })
      fields.push({ key: 'Operating name', value: revision.operatingName })
      fields.push({ key: 'Legal name', value: revision.legalName })
      fields.push({ key: 'UK provider reference number (UKPRN)', value: revision.ukprn })
      fields.push({ key: 'Unique reference number (URN)', value: revision.urn })
      fields.push({ key: 'Provider code', value: revision.code })
      break
    }

    case 'provider_address_revisions': {
      const provider = revision.provider
      const providerName = provider?.operatingName || provider?.legalName || 'Provider'
      const { href: safeHref } = await buildProviderLink(revision.providerId, providerName)
      activity = `Provider address ${getActivityVerb(log.action)}`
      label = providerName
      href = safeHref ? `${safeHref}/addresses` : ''

      fields.push({ key: 'Address line 1', value: revision.line1 })
      fields.push({ key: 'Address line 2', value: revision.line2 })
      fields.push({ key: 'Address line 3', value: revision.line3 })
      fields.push({ key: 'Town or city', value: revision.town })
      fields.push({ key: 'County', value: revision.county })
      fields.push({ key: 'Postcode', value: revision.postcode })
      fields.push({ key: 'Latitude', value: revision.latitude })
      fields.push({ key: 'Longitude', value: revision.longitude })
      break
    }

    case 'provider_contact_revisions': {
      const provider = revision.provider
      const providerName = provider?.operatingName || provider?.legalName || 'Provider'
      const { href: safeHref } = await buildProviderLink(revision.providerId, providerName)
      activity = `Provider contact ${getActivityVerb(log.action)}`
      label = providerName
      href = safeHref ? `${safeHref}/contacts` : ''

      fields.push({ key: 'First name', value: revision.firstName })
      fields.push({ key: 'Last name', value: revision.lastName })
      fields.push({ key: 'Email address', value: revision.email })
      fields.push({ key: 'Phone number', value: revision.telephone })
      break
    }

    case 'provider_accreditation_revisions': {
      const provider = revision.provider
      const providerName = provider?.operatingName || provider?.legalName || 'Provider'
      const { href: safeHref } = await buildProviderLink(revision.providerId, providerName)
      activity = `Provider accreditation ${getActivityVerb(log.action)}`
      label = providerName
      href = safeHref ? `${safeHref}/accreditations` : ''

      accreditationDatesSummary = {
        startsOn: revision.startsOn ? govukDate(revision.startsOn) : 'Not recorded',
        endsOn: revision.endsOn ? govukDate(revision.endsOn) : null
      }

      fields.push({ key: 'Accreditation number', value: revision.number })
      fields.push({ key: 'Accreditation start date', value: accreditationDatesSummary.startsOn })
      fields.push({ key: 'Accreditation end date', value: accreditationDatesSummary.endsOn || 'No end date' })
      break
    }

    case 'provider_partnership_revisions': {
      const accredited = revision.accreditedProvider
      const training = revision.trainingPartner

      const accreditedName = accredited?.operatingName || accredited?.legalName || 'Accredited provider'
      const trainingName = training?.operatingName || training?.legalName || 'Training partner'

      const accreditedProviderId = accredited?.id || revision.accreditedProviderId
      const trainingPartnerId = training?.id || revision.trainingPartnerId

      const { text: accreditedText, href: accreditedHrefBase, html: accreditedHtml } =
        await buildProviderLink(accreditedProviderId, accreditedName)
      const { text: trainingText, href: trainingHrefBase, html: trainingHtml } =
        await buildProviderLink(trainingPartnerId, trainingName)

      const accreditedHref = appendSection(accreditedHrefBase, 'partnerships')
      const trainingHref = appendSection(trainingHrefBase, 'partnerships')

      label = `${accreditedText} – ${trainingText}`
      labelHtml = accreditedHtml && trainingHtml
        ? `${accreditedHref ? `<a class="govuk-link" href="${accreditedHref}">${escapeHtml(accreditedText)}</a>` : escapeHtml(accreditedText)} – ${
            trainingHref ? `<a class="govuk-link" href="${trainingHref}">${escapeHtml(trainingText)}</a>` : escapeHtml(trainingText)
          }`
        : `${escapeHtml(accreditedText)} – ${escapeHtml(trainingText)}`
      href = accreditedHref || trainingHref || ''

      const partnershipId = log.entityId || revision.providerPartnershipId
      const sequelize = require('../models').sequelize
      const actionIsCreate = log.action === 'create'
      const changedAtDate = log.changedAt ? new Date(log.changedAt) : null

      let asOf = actionIsCreate ? null : changedAtDate

      if (actionIsCreate) {
        const nextRevision = await getNextRevision({
          revisionTable,
          revisionId: log.revisionId,
          entityId: log.entityId || revision.providerPartnershipId
        })

        if (nextRevision?.revisionAt) {
          const nextChangedAt = new Date(nextRevision.revisionAt)
          if (changedAtDate) {
            if (nextChangedAt > changedAtDate) {
              const midpoint = changedAtDate.getTime() + (nextChangedAt.getTime() - changedAtDate.getTime()) / 2
              asOf = new Date(midpoint)
            } else {
              asOf = new Date(changedAtDate.getTime() + 1)
            }
          } else {
            asOf = nextChangedAt
          }
        } else {
          asOf = null
        }
      } else if (!changedAtDate) {
        asOf = null
      }

      if (partnershipId) {
        linkedAcademicYears = await getLinkedAcademicYearsAsOf({ sequelize, partnershipId, asOf })
        previousLinkedAcademicYears = actionIsCreate
          ? []
          : await getPrevLinkedAcademicYears({ sequelize, partnershipId, asOf })

        const prevById = new Map(previousLinkedAcademicYears.map(ay => [ay.id, ay]))
        const nowById = new Map(linkedAcademicYears.map(ay => [ay.id, ay]))

        academicYearsAdded = linkedAcademicYears.filter(ay => !prevById.has(ay.id))
        academicYearsRemoved = previousLinkedAcademicYears.filter(ay => !nowById.has(ay.id))
      }

      summaryLinkedAcademicYears = log.action === 'delete'
        ? previousLinkedAcademicYears
        : linkedAcademicYears

      const currentAcademicYearStart = getCurrentAcademicYearStart()
      summaryLinkedAcademicYears = summaryLinkedAcademicYears.map((academicYear) => {
        const statusLabel = getAcademicYearStatusLabel(academicYear, currentAcademicYearStart)
        const text = statusLabel ? `${academicYear.name} - ${statusLabel}` : academicYear.name
        return { ...academicYear, text }
      })

      if (log.action === 'create') {
        activity = 'Provider partnership added'
      } else if (log.action === 'delete') {
        activity = 'Provider partnership deleted'
      } else {
        activity = 'Provider partnership updated'
      }

      const academicYearSummary = summaryLinkedAcademicYears.length
        ? summaryLinkedAcademicYears.map(ay => ay.name).join(', ')
        : 'None linked'

      partnershipDatesSummary = {
        startsOn: revision.startsOn ? govukDate(revision.startsOn) : 'Not recorded',
        endsOn: revision.endsOn ? govukDate(revision.endsOn) : null
      }

      fields.push({ key: 'Accredited provider', value: accreditedText, href: accreditedHref })
      fields.push({ key: 'Training partner', value: trainingText, href: trainingHref })
      fields.push({ key: 'Partnership start date', value: revision.startsOn ? govukDate(revision.startsOn) : 'Not recorded' })
      fields.push({ key: 'Partnership end date', value: revision.endsOn ? govukDate(revision.endsOn) : 'No end date' })
      fields.push({ key: 'Academic years', value: academicYearSummary })
      break
    }

    case 'provider_academic_year_revisions': {
      const provider = revision.provider
      const providerName = provider?.operatingName || provider?.legalName || 'Provider'
      const { text: providerText, href: providerHref } = await buildProviderLink(revision.providerId, providerName)
      const changedAtDate = log.changedAt ? new Date(log.changedAt) : null
      const asOf = changedAtDate ? new Date(changedAtDate) : null
      const academicYears = await getProviderAcademicYearsAsOf({
        providerId: revision.providerId,
        asOf
      })

      const currentAcademicYearStart = getCurrentAcademicYearStart()
      const academicYearItems = academicYears
        .map((entry) => {
          const academicYear = entry.academicYear || entry
          if (!academicYear) return null
          const statusLabel = getAcademicYearStatusLabel(academicYear, currentAcademicYearStart)
          const text = statusLabel
            ? `${academicYear.name || academicYear.code || 'Academic year'} - ${statusLabel}`
            : (academicYear.name || academicYear.code || 'Academic year')
          return {
            text,
            startsOn: academicYear.startsOn,
            endsOn: academicYear.endsOn
          }
        })
        .filter(Boolean)

      const earlierLog = await ActivityLog.findOne({
        where: {
          revisionTable: 'provider_academic_year_revisions',
          changedAt: { [Op.lt]: log.changedAt }
        },
        include: [{
          model: ProviderAcademicYearRevision,
          as: 'providerAcademicYearRevision',
          where: { providerId: revision.providerId },
          required: true
        }]
      })
      activity = earlierLog
        ? 'Provider academic years updated'
        : 'Provider academic years added'
      label = providerText
      href = providerHref

      fields.push({
        key: `Academic year${academicYearItems.length > 1 ? 's' : ''}`,
        academicYears: academicYearItems
      })
      break
    }

    case 'user_revisions': {
      activity = `User ${getActivityVerb(log.action)}`

      // Prefer a proper name, otherwise email, then a generic fallback.
      const fallbackName =
        [revision.firstName, revision.lastName].filter(Boolean).join(' ').trim() ||
        revision.email ||
        'User'

      // Conditionally link if the user is listable; otherwise plain text.
      const { text: userText, href: userHref } = await buildUserLink(revision.userId, fallbackName)

      label = userText
      href = userHref

      fields.push({ key: 'First name', value: revision.firstName })
      fields.push({ key: 'Last name', value: revision.lastName })
      fields.push({ key: 'Email address', value: revision.email })
      break
    }

    case 'academic_year_revisions': {
      activity = `Academic year ${getActivityVerb(log.action)}`

      // Prefer a proper name, otherwise email, then a generic fallback.
      const fallbackName = revision.name || 'Academic year'

      // Conditionally link if the user is listable; otherwise plain text.
      const { text: academicYearText, href: academicYearHref } = await buildAcademicYearLink(revision.academicYearId, fallbackName)

      label = academicYearText
      href = academicYearHref

      fields.push({ key: 'Name', value: revision.name })
      fields.push({ key: 'Starts on', value: govukDate(revision.startsOn) })
      fields.push({ key: 'Ends on', value: govukDate(revision.endsOn) })
      break
    }

    case 'api_client_token_revisions': {
      const fallbackName = revision.clientName || 'API client'
      const { text, href: safeHref, html } = await buildApiClientTokenLink(revision.apiClientTokenId, fallbackName)
      label = text
      href = safeHref
      if (html) labelHtml = html

      if (log.action === 'update') {
        const previousRevision = await getPreviousRevision({
          revisionTable,
          revisionId: log.revisionId,
          entityId: log.entityId
        })

        const isRevoked = revision.status === 'revoked'
        const wasRevoked = previousRevision?.status === 'revoked'

        activity = isRevoked && !wasRevoked
          ? 'API client revoked'
          : 'API client updated'
      } else {
        activity = `API client ${getActivityVerb(log.action)}`
      }

      fields.push({ key: 'Client name', value: revision.clientName })
      fields.push({ key: 'Expiry date', value: revision.expiresAt ? govukDate(revision.expiresAt) : 'Not entered' })
      break
    }

    default:
      label = 'Unknown revision'
  }

  return {
    action,
    activity,
    label,
    href,
    fields,
    ...(labelHtml && { labelHtml }),
    ...(revisionTable === 'provider_partnership_revisions'
        ? {
            linkedAcademicYears: summaryLinkedAcademicYears,
            academicYearsAdded,
            academicYearsRemoved,
            partnershipDates: partnershipDatesSummary || { startsOn: 'Not entered', endsOn: null }
          }
        : {}),
    ...(revisionTable === 'provider_accreditation_revisions'
        ? {
            accreditationDates: accreditationDatesSummary || { startsOn: 'Not entered', endsOn: null }
          }
        : {})
  }
}

/**
 * Returns the previous revision for a given entity (based on revisionNumber ordering).
 *
 * @async
 * @param {Object} options
 * @param {string} options.revisionTable - Name of the revision table.
 * @param {string} options.revisionId - ID of the current revision.
 * @param {string} options.entityId - ID of the associated entity.
 * @returns {Promise<Object|null>} The previous revision or null if none exists.
 */
const getPreviousRevision = async ({ revisionTable, revisionId, entityId }) => {
  const revisionModel = getRevisionModel(revisionTable)
  if (!revisionModel) throw new Error(`Unknown revision table: ${revisionTable}`)

  const entityKeys = getEntityKeys(revisionTable)
  const whereClause = { [Op.or]: entityKeys.map(key => ({ [key]: entityId })) }

  const revisions = await revisionModel.findAll({
    where: whereClause,
    order: [['revisionNumber', 'ASC']]
  })

  const index = revisions.findIndex(r => r.id === revisionId)
  return index > 0 ? revisions[index - 1] : null
}

/**
 * Returns the next revision for a given entity (based on revisionNumber ordering).
 *
 * @async
 * @param {Object} options
 * @param {string} options.revisionTable - Name of the revision table.
 * @param {string} options.revisionId - ID of the current revision.
 * @param {string} options.entityId - ID of the associated entity.
 * @returns {Promise<Object|null>} The next revision or null if none exists.
 */
const getNextRevision = async ({ revisionTable, revisionId, entityId }) => {
  const revisionModel = getRevisionModel(revisionTable)
  if (!revisionModel) throw new Error(`Unknown revision table: ${revisionTable}`)

  const entityKeys = getEntityKeys(revisionTable)
  const whereClause = { [Op.or]: entityKeys.map(key => ({ [key]: entityId })) }

  const revisions = await revisionModel.findAll({
    where: whereClause,
    order: [['revisionNumber', 'ASC']]
  })

  const index = revisions.findIndex(r => r.id === revisionId)
  return index >= 0 && index < revisions.length - 1 ? revisions[index + 1] : null
}

/**
 * Returns the most recent revision for a given entity in the specified revision table.
 *
 * @async
 * @param {Object} options
 * @param {string} options.revisionTable - Name of the revision table.
 * @param {string} options.entityId - ID of the associated entity.
 * @returns {Promise<Object|null>} The latest revision or null if none exists.
 */
const getLatestRevision = async ({ revisionTable, entityId }) => {
  const revisionModel = getRevisionModel(revisionTable)
  if (!revisionModel) throw new Error(`Unknown revision table: ${revisionTable}`)

  const entityKeys = getEntityKeys(revisionTable)
  const whereClause = { [Op.or]: entityKeys.map(key => ({ [key]: entityId })) }

  return revisionModel.findOne({
    where: whereClause,
    order: [['revisionNumber', 'DESC']]
  })
}

/**
 * Groups formatted activity logs by date.
 *
 * @param {Object[]} logs - Array of formatted activity log entries.
 * @returns {Object[]} An array of groups with { label, entries }.
 */
const groupActivityLogsByDate = (logs) => {
  const groups = {}

  for (const log of logs) {
    const date = new Date(log.changedAt)

    let label
    if (isToday(date)) {
      label = 'Today'
    } else if (isYesterday(date)) {
      label = 'Yesterday'
    } else {
      label = govukDate(date)
    }

    if (!groups[label]) groups[label] = []
    groups[label].push(log)
  }

  // Convert to array in descending order of date
  return Object.entries(groups)
    .map(([label, entries]) => ({ label, entries }))
    .sort((a, b) => new Date(b.entries[0].changedAt) - new Date(a.entries[0].changedAt))
}

/**
 * Fetch the accreditations that link an accredited provider to a training partner
 * as of a specific timestamp. Uses `paranoid:false` to evaluate historical state.
 *
 * @param {Object} params
 * @param {import('sequelize').Sequelize} params.sequelize
 * @param {string} params.accreditedProviderId
 * @param {string} params.partnerId
 * @param {Date} params.asOf
 * @returns {Promise<LinkedAccreditation[]>}
 */
const buildAcademicYearWhere = (partnershipId, asOf) => {
  if (!asOf) {
    return {
      partnershipId,
      deletedAt: null
    }
  }

  return {
    partnershipId,
    createdAt: { [Op.lte]: asOf },
    [Op.or]: [{ deletedAt: null }, { deletedAt: { [Op.gt]: asOf } }]
  }
}

const getLinkedAcademicYearsAsOf = async ({ sequelize, partnershipId, asOf = null }) => {
  const links = await ProviderPartnershipAcademicYear.findAll({
    paranoid: false,
    where: buildAcademicYearWhere(partnershipId, asOf),
    include: [{
      model: AcademicYear,
      as: 'academicYear',
      required: true,
      attributes: ['id', 'name', 'startsOn', 'endsOn']
    }],
    attributes: ['createdAt', 'deletedAt']
  })

  return links.map(link => ({
    id: link.academicYear.id,
    name: link.academicYear.name,
    startsOn: link.academicYear.startsOn || null,
    endsOn: link.academicYear.endsOn || null
  }))
}

const getPrevLinkedAcademicYears = async ({ sequelize, partnershipId, asOf, epsilonMs = 2000 }) => {
  if (!asOf) return []
  const prevAsOf = new Date(asOf.getTime() - epsilonMs)
  return getLinkedAcademicYearsAsOf({ sequelize, partnershipId, asOf: prevAsOf })
}

function buildProviderAcademicYearWhere (providerId, asOf) {
  if (!asOf) {
    return {
      providerId,
      deletedAt: null
    }
  }

  return {
    providerId,
    createdAt: { [Op.lte]: asOf },
    [Op.or]: [{ deletedAt: null }, { deletedAt: { [Op.gt]: asOf } }]
  }
}

async function getProviderAcademicYearsAsOf ({ providerId, asOf = null }) {
  return ProviderAcademicYear.findAll({
    paranoid: false,
    where: buildProviderAcademicYearWhere(providerId, asOf),
    include: [{
      model: AcademicYear,
      as: 'academicYear',
      attributes: ['id', 'name', 'code', 'startsOn', 'endsOn']
    }],
    order: [[{ model: AcademicYear, as: 'academicYear' }, 'startsOn', 'DESC']]
  })
}


/**
 * Get the last update for a provider across:
 * - provider (itself)
 * - accreditations (owned by the provider)
 * - addresses (owned by the provider)
 * - contacts (owned by the provider)
 * - partnerships (either provider is the accrediting provider via its accreditations OR provider is the partner)
 *
 * Any action counts (create/update/delete/archive/restore/etc.).
 *
 * @param {string} providerId - UUID of the provider.
 * @param {object} [opts]
 * @param {object} [opts.transaction] - Optional Sequelize transaction.
 * @param {boolean} [opts.includeDeletedChildren=false] - Include soft-deleted children when gathering IDs.
 * @param {object} [opts.entityTypes] - Override entity_type strings used in activity_logs.
 * @returns {Promise<{
 *   changedAt: Date|null,
 *   changedByUser: { id: string, firstName?: string, lastName?: string, email?: string }|null,
 *   action: string|null,
 *   entityType?: string,
 *   entityId?: string,
 *   revisionTable?: string,
 *   revisionId?: string,
 *   revisionNumber?: number
 * }>}
 */
const getProviderLastUpdated = async (providerId, opts = {}) => {
  const {
    transaction,
    includeDeletedChildren = false,
    entityTypes = {
      provider: 'provider',
      accreditation: 'provider_accreditation',
      address: 'provider_address',
      contact: 'provider_contact',
      partnership: 'provider_partnership'
    }
  } = opts

  // 1) Gather related IDs (optionally exclude soft-deleted)
  const childWhere = (extra = {}) =>
    includeDeletedChildren ? extra : { ...extra, deletedAt: null }

  const [accreditationRows, addressRows, contactRows] = await Promise.all([
    ProviderAccreditation.findAll({
      attributes: ['id'],
      where: childWhere({ providerId }),
      transaction
    }),
    ProviderAddress.findAll({
      attributes: ['id'],
      where: childWhere({ providerId }),
      transaction
    }),
    ProviderContact.findAll({
      attributes: ['id'],
      where: childWhere({ providerId }),
      transaction
    })
  ])

  const accreditationIds = accreditationRows.map(r => r.id)
  const addressIds = addressRows.map(r => r.id)
  const contactIds = contactRows.map(r => r.id)

  const partnershipRows = await ProviderPartnership.findAll({
    attributes: ['id'],
    where: childWhere({
      [Op.or]: [
        { accreditedProviderId: providerId },
        { trainingPartnerId: providerId }
      ]
    }),
    transaction
  })
  const partnershipIds = partnershipRows.map(r => r.id)


  // 2) Pull the latest log per entity type (no action filter — any action counts)
  const latestFinds = await Promise.all([
    // provider itself
    ActivityLog.findOne({
      where: { entityType: entityTypes.provider, entityId: providerId },
      include: [{ model: User, as: 'changedByUser', attributes: ['id', 'firstName', 'lastName', 'email'] }],
      order: [['changedAt', 'DESC']],
      transaction
    }),

    // accreditations
    accreditationIds.length
      ? ActivityLog.findOne({
          where: { entityType: entityTypes.accreditation, entityId: { [Op.in]: accreditationIds } },
          include: [{ model: User, as: 'changedByUser', attributes: ['id', 'firstName', 'lastName', 'email'] }],
          order: [['changedAt', 'DESC']],
          transaction
        })
      : null,

    // addresses
    addressIds.length
      ? ActivityLog.findOne({
          where: { entityType: entityTypes.address, entityId: { [Op.in]: addressIds } },
          include: [{ model: User, as: 'changedByUser', attributes: ['id', 'firstName', 'lastName', 'email'] }],
          order: [['changedAt', 'DESC']],
          transaction
        })
      : null,

    // contacts
    contactIds.length
      ? ActivityLog.findOne({
          where: { entityType: entityTypes.contact, entityId: { [Op.in]: contactIds } },
          include: [{ model: User, as: 'changedByUser', attributes: ['id', 'firstName', 'lastName', 'email'] }],
          order: [['changedAt', 'DESC']],
          transaction
        })
      : null,

    // partnerships
    partnershipIds.length
      ? ActivityLog.findOne({
          where: { entityType: entityTypes.partnership, entityId: { [Op.in]: partnershipIds } },
          include: [{ model: User, as: 'changedByUser', attributes: ['id', 'firstName', 'lastName', 'email'] }],
          order: [['changedAt', 'DESC']],
          transaction
        })
      : null,

  ])

  // 3) Choose the most recent
  const candidates = latestFinds.filter(Boolean)
  if (!candidates.length) {
    return { changedAt: null, changedByUser: null, action: null }
  }
  candidates.sort((a, b) => new Date(b.changedAt) - new Date(a.changedAt))
  const log = candidates[0]

  return {
    changedAt: log.changedAt ?? null,
    changedByUser: log.changedByUser
      ? {
          id: log.changedByUser.id,
          firstName: log.changedByUser.firstName,
          lastName: log.changedByUser.lastName,
          email: log.changedByUser.email
        }
      : null,
    action: log.action ?? null,
    entityType: log.entityType,
    entityId: log.entityId,
    revisionTable: log.revisionTable,
    revisionId: log.revisionId,
    revisionNumber: log.revisionNumber
  }
}

module.exports = {
  getActivityLogs,
  getActivityTotalCount,
  getProviderActivityLogs,
  getProviderActivityTotalCount,
  getUserActivityLogs,
  getUserActivityTotalCount,
  getPreviousRevision,
  getNextRevision,
  getLatestRevision,
  groupActivityLogsByDate,
  getLinkedAcademicYearsAsOf,
  getPrevLinkedAcademicYears,
  getProviderLastUpdated
}
