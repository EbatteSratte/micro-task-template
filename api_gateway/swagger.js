const swaggerJsdoc = require('swagger-jsdoc');

const PORT = process.env.PORT || 8000;

const swaggerOptions = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Microservices API Gateway',
            version: '1.0.0',
            description: 'API Gateway для управления пользователями и заказами',
            contact: {
                name: 'API Support',
                email: 'support@example.com'
            }
        },
        servers: [
            {
                url: `http://localhost:${PORT}`,
                description: 'Development server'
            }
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT'
                }
            },
            schemas: {
                User: {
                    type: 'object',
                    properties: {
                        id: { type: 'string', description: 'Уникальный идентификатор пользователя' },
                        email: { type: 'string', format: 'email', description: 'Email пользователя' },
                        name: { type: 'string', description: 'Имя пользователя' },
                        roles: { 
                            type: 'array', 
                            items: { 
                                type: 'string', 
                                enum: ['Customer', 'Engineer', 'Manager', 'Admin'] 
                            },
                            description: 'Роли пользователя'
                        },
                        createdAt: { type: 'string', format: 'date-time' },
                        updatedAt: { type: 'string', format: 'date-time' }
                    }
                },
                Order: {
                    type: 'object',
                    properties: {
                        id: { type: 'string', description: 'Уникальный идентификатор заказа' },
                        userId: { type: 'string', description: 'ID пользователя' },
                        status: { 
                            type: 'string', 
                            enum: ['pending', 'processing', 'completed', 'cancelled'],
                            description: 'Статус заказа'
                        },
                        items: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    productId: { type: 'string', description: 'ID продукта' },
                                    quantity: { type: 'integer', minimum: 1, description: 'Количество' },
                                    price: { type: 'number', minimum: 0, description: 'Цена за единицу' },
                                    subtotal: { type: 'number', minimum: 0, description: 'Промежуточная сумма' }
                                }
                            }
                        },
                        totalAmount: { type: 'number', minimum: 0, description: 'Общая сумма заказа' },
                        createdAt: { type: 'string', format: 'date-time' },
                        updatedAt: { type: 'string', format: 'date-time' }
                    }
                },
                Error: {
                    type: 'object',
                    properties: {
                        success: { type: 'boolean', example: false },
                        error: { 
                            type: 'object',
                            properties: {
                                message: { type: 'string', description: 'Сообщение об ошибке' }
                            }
                        }
                    }
                },
                LoginRequest: {
                    type: 'object',
                    required: ['email', 'password'],
                    properties: {
                        email: {
                            type: 'string',
                            format: 'email',
                            description: 'Email пользователя'
                        },
                        password: {
                            type: 'string',
                            description: 'Пароль пользователя'
                        }
                    }
                },
                RegisterRequest: {
                    type: 'object',
                    required: ['email', 'password', 'name'],
                    properties: {
                        email: {
                            type: 'string',
                            format: 'email',
                            description: 'Email пользователя'
                        },
                        password: {
                            type: 'string',
                            minLength: 6,
                            description: 'Пароль (минимум 6 символов)'
                        },
                        name: {
                            type: 'string',
                            description: 'Имя пользователя'
                        },
                        roles: {
                            type: 'array',
                            items: {
                                type: 'string',
                                enum: ['Customer', 'Engineer', 'Manager', 'Admin']
                            },
                            description: 'Роли пользователя (опционально)'
                        }
                    }
                },
                CreateOrderRequest: {
                    type: 'object',
                    required: ['items'],
                    properties: {
                        items: {
                            type: 'array',
                            items: {
                                type: 'object',
                                required: ['productId', 'quantity', 'price'],
                                properties: {
                                    productId: { type: 'string', description: 'ID продукта' },
                                    quantity: { type: 'integer', minimum: 1, description: 'Количество' },
                                    price: { type: 'number', minimum: 0, description: 'Цена за единицу' }
                                }
                            }
                        }
                    }
                },
                UpdateOrderStatusRequest: {
                    type: 'object',
                    required: ['status'],
                    properties: {
                        status: {
                            type: 'string',
                            enum: ['pending', 'processing', 'completed', 'cancelled'],
                            description: 'Новый статус заказа'
                        }
                    }
                }
            }
        },
        security: [
            {
                bearerAuth: []
            }
        ]
    },
    apis: ['./swagger-docs.js']
};

const specs = swaggerJsdoc(swaggerOptions);

module.exports = { specs, swaggerOptions };