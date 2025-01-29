const { Model, DataTypes } = require('sequelize')

module.exports = (sequelize) => {
  class ProviderAddress extends Model {
    static associate(models) {
      ProviderAddress.belongsTo(models.Provider, {
        foreignKey: 'provider_id',
        as: 'provider'
      })

      ProviderAddress.belongsTo(models.User, {
        foreignKey: 'created_by_id',
        as: 'createdByUser'
      })

      ProviderAddress.belongsTo(models.User, {
        foreignKey: 'updated_by_id',
        as: 'updatedByUser'
      })
    }
  }

  ProviderAddress.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
      },
      providerId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'provider_id'
      },
      line_1:  {
        type: DataTypes.STRING,
        validate: {
          notEmpty: true
        }
      },
      line_2: {
        type: DataTypes.STRING
      },
      line_3: {
        type: DataTypes.STRING
      },
      town:  {
        type: DataTypes.STRING,
        validate: {
          notEmpty: true
        }
      },
      county: {
        type: DataTypes.STRING
      },
      postcode:  {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
          notEmpty: true,
          is: /^(([A-Z]{1,2}[0-9][A-Z0-9]?|ASCN|STHL|TDCU|BBND|[BFS]IQQ|PCRN|TKCA) ?[0-9][A-Z]{2}|BFPO ?[0-9]{1,4}|(KY[0-9]|MSR|VG|AI)[ -]?[0-9]{4}|[A-Z]{2} ?[0-9]{2}|GE ?CX|GIR ?0A{2}|SAN ?TA1)$/
        }
      },
      latitude: {
        type: DataTypes.FLOAT
      },
      longitude: {
        type: DataTypes.FLOAT
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'created_at'
      },
      createdById: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'created_by_id'
      },
      updatedAt: {
        type: DataTypes.DATE,
        field: 'updated_at'
      },
      updatedById: {
        type: DataTypes.UUID,
        field: 'updated_by_id'
      }
    },
    {
      sequelize,
      modelName: 'ProviderAddress',
      tableName: 'provider_addresses'
    }
  )

  return ProviderAddress
}
