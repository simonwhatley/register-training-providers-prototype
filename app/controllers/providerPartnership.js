const Pagination = require('../helpers/pagination')
const { v4: uuid } = require('uuid')
const { Provider, ProviderAccreditation, ProviderPartnership } = require('../models')
const { Op } = require('sequelize')

/// ------------------------------------------------------------------------ ///
/// List provider partnerships
/// ------------------------------------------------------------------------ ///

exports.providerPartnershipsList = async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1
  const limit = parseInt(req.query.limit, 10) || 50
  const offset = (page - 1) * limit

  // get the providerId from the request for use in subsequent queries
  const { providerId } = req.params

  // get the current provider
  const provider = await Provider.findByPk(providerId)

  // set a date for use in determining if the provider is accredited
  const now = new Date()

  // find all valid accreditations for the provider
  const accreditationCount = await ProviderAccreditation.count({
    where: {
      providerId,
      startsOn: { [Op.lte]: now },
      [Op.or]: [
        { endsOn: null },
        { endsOn: { [Op.gte]: now } }
      ]
    }
  })

  // calculate if the provider is accredited
  const isAccredited = ((accreditationCount > 0)) // true|false

  // Get the total number of partnerships for pagination metadata
  const totalCount = await ProviderPartnership.count({
    where: {
        [Op.or]: [
        { accreditedProviderId: providerId },
        { trainingProviderId: providerId },
      ]
    }
  })

  // Only fetch ONE page of partnerships
  const partnerships = await ProviderPartnership.findAll({
    where: {
      [Op.or]: [
        { accreditedProviderId: providerId },
        { trainingProviderId: providerId },
      ]
    },
    order: [
      ['accreditedProviderId', 'ASC'],
      ['trainingProviderId', 'ASC']
    ],
    limit,
    offset,
    include: [
      {
        model: Provider,
        as: isAccredited ? 'trainingProvider' : 'accreditedProvider'
      }
    ]
  })

  // Create your Pagination object
  // using the chunk + the overall total count
  const pagination = new Pagination(partnerships, totalCount, page, limit)

  // Clear session provider data
  delete req.session.data.partnership

  res.render('providers/partnership/index', {
    provider,
    isAccredited,
    // Partnerships for *this* page
    partnerships: pagination.getData(),
    // The pagination metadata (pageItems, nextPage, etc.)
    pagination
  })
}

/// ------------------------------------------------------------------------ ///
/// Show single provider partnership
/// ------------------------------------------------------------------------ ///

exports.providerPartnershipDetails = async (req, res) => {
  // Clear session partnership data
  delete req.session.data.partnership

  const partnership = await ProviderPartnership.findByPk(req.params.partnershipId, {
    include: [
      {
        model: Provider,
        as: 'provider'
      }
    ]
  })
  res.render('providers/partnership/show', { partnership })
}

/// ------------------------------------------------------------------------ ///
/// New provider partnership
/// ------------------------------------------------------------------------ ///

exports.newProviderPartnership_get = async (req, res) => {
  const provider = await Provider.findByPk(req.params.providerId)

  let back = `/providers/${req.params.providerId}`
  if (req.query.referrer === 'check') {
    back = `/providers/${req.params.providerId}/partnerships/new/check`
  }

  res.render('providers/partnership/edit', {
    provider,
    partnership: req.session.data.partnership,
    actions: {
      back,
      cancel: `/providers/${req.params.providerId}`,
      save: `/providers/${req.params.providerId}/partnerships/new`
    }
  })
}

exports.newProviderPartnership_post = async (req, res) => {
  const provider = await Provider.findByPk(req.params.providerId)
  const errors = []

  if (!req.session.data.partnership.number.length) {
    const error = {}
    error.fieldName = "number"
    error.href = "#number"
    error.text = "Enter an accredited provider number"
    errors.push(error)
  }

  if (errors.length) {
    let back = `/providers/${req.params.providerId}`
    if (req.query.referrer === 'check') {
      back = `/providers/${req.params.providerId}/partnerships/new/check`
    }

    res.render('providers/partnership/edit', {
      provider,
      partnership: req.session.data.partnership,
      errors,
      actions: {
        back,
        cancel: `/providers/${req.params.providerId}`,
        save: `/providers/${req.params.providerId}/partnerships/new`
      }
    })
  } else {
    res.redirect(`/providers/${req.params.providerId}/partnerships/new/check`)
  }
}

exports.newProviderPartnershipCheck_get = async (req, res) => {
  const provider = await Provider.findByPk(req.params.providerId)
  res.render('providers/partnership/check-your-answers', {
    provider,
    partnership: req.session.data.partnership,
    actions: {
      back: `/providers/${req.params.providerId}/partnerships/new`,
      cancel: `/providers/${req.params.providerId}`,
      change: `/providers/${req.params.providerId}/partnerships/new`,
      save: `/providers/${req.params.providerId}/partnerships/new/check`
    }
  })
}

exports.newProviderPartnershipCheck_post = async (req, res) => {
  await ProviderPartnership.create({
    id: uuid(),
    createdAt: new Date(),
    createdById: req.session.passport.user.id
  })

  delete req.session.data.partnership

  req.flash('success', 'Partnership added')
  res.redirect(`/providers/${req.params.providerId}`)
}

/// ------------------------------------------------------------------------ ///
/// Edit provider partnership
/// ------------------------------------------------------------------------ ///

exports.editProviderPartnership_get = async (req, res) => {
  const provider = await Provider.findByPk(req.params.providerId)
  const currentPartnership = await ProviderPartnership.findByPk(req.params.partnershipId)

  let partnership
  if (req.session.data?.partnership) {
    partnership = req.session.data.partnership
  } else {
    partnership = await ProviderPartnership.findByPk(req.params.partnershipId)
  }

  let back = `/providers/${req.params.providerId}`
  if (req.query.referrer === 'check') {
    back = `/providers/${req.params.providerId}/partnerships/${req.params.partnershipId}/edit/check`
  }

  res.render('providers/partnership/edit', {
    provider,
    currentPartnership,
    partnership,
    actions: {
      back,
      cancel: `/providers/${req.params.providerId}`,
      save: `/providers/${req.params.providerId}/partnerships/${req.params.partnershipId}/edit`
    }
  })
}

exports.editProviderPartnership_post = async (req, res) => {
  const provider = await Provider.findByPk(req.params.providerId)
  const currentPartnership = await ProviderPartnership.findByPk(req.params.partnershipId)

  const errors = []

  if (!req.session.data.partnership.number.length) {
    const error = {}
    error.fieldName = "number"
    error.href = "#number"
    error.text = "Enter an accredited provider number"
    errors.push(error)
  }

  if (errors.length) {
    let back = `/providers/${req.params.providerId}`
    if (req.query.referrer === 'check') {
      back = `/providers/${req.params.providerId}/partnerships/${req.params.partnershipId}/edit/check`
    }

    res.render('providers/partnership/edit', {
      provider,
      currentPartnership,
      partnership: req.session.data.partnership,
      errors,
      actions: {
        back,
        cancel: `/providers/${req.params.providerId}`,
        save: `/providers/${req.params.providerId}/partnerships/${req.params.partnershipId}/edit`
      }
    })
  } else {
    res.redirect(`/providers/${req.params.providerId}/partnerships/${req.params.partnershipId}/edit/check`)
  }
}

exports.editProviderPartnershipCheck_get = async (req, res) => {
  const provider = await Provider.findByPk(req.params.providerId)
  const currentPartnership = await ProviderPartnership.findByPk(req.params.partnershipId)

  res.render('providers/partnership/check-your-answers', {
    provider,
    currentPartnership,
    partnership: req.session.data.partnership,
    actions: {
      back: `/providers/${req.params.providerId}/partnerships/${req.params.partnershipId}/edit`,
      cancel: `/providers/${req.params.providerId}`,
      change: `/providers/${req.params.providerId}/partnerships/${req.params.partnershipId}/edit`,
      save: `/providers/${req.params.providerId}/partnerships/${req.params.partnershipId}/edit/check`
    }
  })
}

exports.editProviderPartnershipCheck_post = async (req, res) => {
  const partnership = await ProviderPartnership.findByPk(req.params.partnershipId)
  await partnership.update({
    updatedAt: new Date(),
    updatedById: req.session.passport.user.id
  })

  delete req.session.data.partnership

  req.flash('success', 'Partnership updated')
  res.redirect(`/providers/${req.params.providerId}`)
}

/// ------------------------------------------------------------------------ ///
/// Delete provider partnership
/// ------------------------------------------------------------------------ ///

exports.deleteProviderPartnership_get = async (req, res) => {
  const provider = await Provider.findByPk(req.params.providerId)
  const partnership = await ProviderPartnership.findByPk(req.params.partnershipId)
  res.render('providers/partnership/delete', {
    provider,
    partnership,
    actions: {
      back: `/providers/${req.params.providerId}`,
      cancel: `/providers/${req.params.providerId}`,
      save: `/providers/${req.params.providerId}/partnerships/${req.params.partnershipId}/delete`
    }
  })
}

exports.deleteProviderPartnership_post = async (req, res) => {
  const partnership = await ProviderPartnership.findByPk(req.params.partnershipId)
  await partnership.destroy()

  req.flash('success', 'Partnership removed')
  res.redirect(`/providers/${req.params.providerId}`)
}
