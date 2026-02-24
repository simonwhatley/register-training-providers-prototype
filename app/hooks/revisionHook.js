/**
 * Generic revisioning hook.
 * Creates a new revision row for a model whenever tracked fields change.
 */

const revisionFields = require('../constants/revisionFields')

/**
 * @typedef {Object} RevisionHookConfig
 * @property {string} revisionModelName - The Sequelize model name of the revision table (e.g. 'ProviderContactRevision').
 * @property {string} modelKey          - Key used in `revisionFields` and to construct FK (e.g. 'providerContact' -> 'providerContactId').
 */

/**
 * @typedef {Object} RevisionHookOptions
 * @property {'afterCreate'|'afterUpdate'|'afterDestroy'} [hookName] - Name of the lifecycle hook that invoked this function.
 * // Note: Sequelize will pass many other options (transaction, logging, etc.); we keep the type open.
 */

/**
 * Factory that returns a Sequelize hook to create revision rows.
 *
 * Behaviour:
 *  - On creation (`afterCreate`), writes revision #1.
 *  - On updates, compares only fields listed in `revisionFields[modelKey]`;
 *    if any changed, increments `revisionNumber` and writes a new row.
 *  - Sets `revisionById` from `updatedById` falling back to `createdById`.
 *  - Sets `revisionAt` on write (so activities have a stable timestamp).
 *  - Emits an `activityAction` alongside the create so the activity hook
 *    can log 'create'/'update' (and 'delete' if you detect soft delete).
 *
 * Soft deletes:
 *  - If you soft-delete on the *source* model (set `deletedAt` then save),
 *    detect that change here and pass `activityAction: 'delete'`.
 *
 * @param {RevisionHookConfig} param0
 * @returns {(instance: import('sequelize').Model, options?: RevisionHookOptions) => Promise<void>}
 */
const revisionHook = ({ revisionModelName, modelKey }) => {
  return async (instance, options = {}) => {
    const sequelize = instance.sequelize
    const RevisionModel = sequelize.models[revisionModelName]
    const revisionAttrs = new Set(Object.keys(RevisionModel.rawAttributes))
    const trackedFields = (revisionFields[modelKey] || []).filter((field) => revisionAttrs.has(field))

    const tx = options?.transaction // use the same transaction as the caller

    const revisionById =
      instance.get('updatedById') ||
      instance.get('createdById') ||
      null

    const src = instance.get({ plain: true })
    const pickForRevision = (obj) => {
      const omit = new Set(['id'])
      return Object.fromEntries(
        Object.entries(obj).filter(([k]) => revisionAttrs.has(k) && !omit.has(k))
      )
    }

    const buildPayload = (overrides = {}) => ({
      ...pickForRevision(src),
      [`${modelKey}Id`]: instance.id,
      revisionById,
      revisionAt: options.revisionAt || new Date(),
      ...overrides
    })

    // First revision on create
    if (options?.hookName === 'afterCreate') {
      await RevisionModel.create(
        buildPayload({ revisionNumber: 1 }),
        { transaction: tx, activityAction: 'create' }
      )
      return
    }

    // Load latest inside the same transaction
    const latest = await RevisionModel.findOne({
      where: { [`${modelKey}Id`]: instance.id },
      order: [['revisionNumber', 'DESC']],
      transaction: tx
    })

    if (!latest) {
      await RevisionModel.create(
        buildPayload({ revisionNumber: 1 }),
        { transaction: tx, activityAction: 'create' }
      )
      return
    }

    const hasChanged = trackedFields.some((field) => instance.get(field) !== latest.get(field))
    const deletedAtChanged =
      typeof instance.changed === 'function' ? instance.changed('deletedAt') : false

    if (!hasChanged && !deletedAtChanged) return

    const isDelete = deletedAtChanged && instance.get('deletedAt') != null

    await RevisionModel.create(
      buildPayload({ revisionNumber: latest.revisionNumber + 1 }),
      { transaction: tx, activityAction: isDelete ? 'delete' : 'update' }
    )
  }
}

module.exports = revisionHook
