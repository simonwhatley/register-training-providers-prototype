module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('Users', null, {})

    await queryInterface.bulkInsert('Users', [
      {
        id: '3faa7586-951b-495c-9999-e5fc4367b507',
        first_name: 'Anne',
        last_name: 'Wilson',
        email: 'anne@example.com',
        password: 'bat',
        is_active: true,
        created_at: new Date(),
        created_by_id: '354751f2-c5f7-483c-b9e4-b6103f50f970'
      },
      {
        id: '99c07212-6395-40b5-9776-9210645a5028',
        first_name: 'Mary',
        last_name: 'Lawson',
        email: 'mary@example.com',
        password: 'bat',
        is_active: true,
        created_at: new Date(),
        created_by_id: '354751f2-c5f7-483c-b9e4-b6103f50f970'
      },
      {
        id: '354751f2-c5f7-483c-b9e4-b6103f50f970',
        first_name: 'Colin',
        last_name: 'Chapman',
        email: 'colin.chapman@example.gov.uk',
        password: 'bat',
        is_active: true,
        created_at: new Date(),
        created_by_id: '354751f2-c5f7-483c-b9e4-b6103f50f970'
      },
    ], {})
  },
  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('Users', null, {})
  }
}
