const govukPrototypeKit = require('govuk-prototype-kit')
const addFilter = govukPrototypeKit.views.addFilter

const { govukDate, govukDateTime, govukTime, isoDateFromDateInput } = require('./helpers/dates.js')

/* ------------------------------------------------------------------
utility function to get an error for a component
example: {{ errors | getErrorMessage('title') }}
outputs: "Enter a title"
------------------------------------------------------------------ */
addFilter('getErrorMessage', (array, fieldName) => {
  if (!array || !fieldName) {
    return null
  }

  const error = array.filter((obj) =>
    obj.fieldName === fieldName
  )[0]

  return error
})

/* ------------------------------------------------------------------
utility function to get provider type label
example: {{ "scitt" | getProviderTypeLabel() }}
outputs: "School-centred initial teacher training (SCITT)"
------------------------------------------------------------------ */
addFilter('getProviderTypeLabel', (code) => {
  if (!code) {
    return null
  }

  let label = code

  switch (code) {
    case 'hei':
      label = 'Higher education institution (HEI)'
      break
    case 'scitt':
      label = 'School-centred initial teacher training (SCITT)'
      break
    case 'school':
      label = 'School'
      break
  }

  return label
})

/* ------------------------------------------------------------------
 date filter for use in Nunjucks
 example: {{ params.date | govukDate }}
 outputs: 1 January 1970
------------------------------------------------------------------ */
addFilter('govukDate', govukDate)

/* ------------------------------------------------------------------
 time filter for use in Nunjucks
 example: {{ params.date | govukTime }}
 outputs: 3:33pm
------------------------------------------------------------------ */
addFilter('govukTime', govukTime)

/* ------------------------------------------------------------------
 datetime filter for use in Nunjucks
 example: {{ params.date | govukDateTime }}
 outputs: 1 January 1970 at 3:33pm
 example: {{ params.date | govukDateTime("on") }}
 outputs: 3:33pm on 1 January 1970
------------------------------------------------------------------ */
addFilter('govukDateTime', govukDateTime)

/* ------------------------------------------------------------------
 date input filter for use in Nunjucks
 example: {{ params.dateObject | isoDateFromDateInput }}
 outputs: 1970-01-01
------------------------------------------------------------------ */
addFilter('isoDateFromDateInput', isoDateFromDateInput)
