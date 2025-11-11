const express = require('express');
const cors = require('cors');
const axios = require('axios');
const CircuitBreaker = require('opossum');
const jwt = require('jsonwebtoken');
const pino = require('pino');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const { specs } = require('./swagger');
const { 
    OrderCreatedEvent, 
    OrderStatusUpdatedEvent, 
    OrderCancelledEvent, 
    EventPublisher, 
    OrderEventHandlers 
} = require('./domain-events');

const logger = pino({
    level: process.env.LOG_LEVEL || 'info'
});

const eventPublisher = new EventPublisher(logger);
const orderEventHandlers = new OrderEventHandlers(logger);

eventPublisher.subscribe('order.created', orderEventHandlers.handleOrderCreated.bind(orderEventHandlers));
eventPublisher.subscribe('order.status.updated', orderEventHandlers.handleOrderStatusUpdated.bind(orderEventHandlers));
eventPublisher.subscribe('order.cancelled', orderEventHandlers.handleOrderCancelled.bind(orderEventHandlers));

const app = express();
const PORT = process.env.PORT || 8000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: {
        success: false,
        error: 'Too many requests from this IP, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: {
        success: false,
        error: 'Too many authentication attempts, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(generalLimiter);

app.use((req, res, next) => {
    const startTime = Date.now();
    
    res.on('finish', () => {
        const duration = (Date.now() - startTime) / 1000;
        const timestamp = new Date().toISOString().replace('T', ' ').slice(0, -5);
        const remoteAddr = req.ip || req.connection.remoteAddress || '-';
        const remoteUser = req.user ? req.user.id : '-';
        const request = `${req.method} ${req.originalUrl} HTTP/${req.httpVersion}`;
        const status = res.statusCode;
        const bodyBytesSent = res.get('content-length') || '-';
        const httpReferer = req.headers.referer || '-';
        const httpUserAgent = req.headers['user-agent'] || '-';
        const requestTime = duration.toFixed(3);
        
        // Format: $remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent" $request_time
        const logLine = `${remoteAddr} - ${remoteUser} [${timestamp}] "${request}" ${status} ${bodyBytesSent} "${httpReferer}" "${httpUserAgent}" ${requestTime}`;
        
        console.log(logLine);
    });
    
    next();
});

// Swagger UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs, {
    explorer: true,
    customCss: '.swagger-ui .topbar { display: none }'
}));

// API Version
const API_VERSION = '/api/v1';

// Service URLs
const USERS_SERVICE_URL = 'http://service_users:8000';
const ORDERS_SERVICE_URL = 'http://service_orders:8000';

// Circuit Breaker configuration
const circuitOptions = {
    timeout: 3000, // Timeout for requests (3 seconds)
    errorThresholdPercentage: 50, // Open circuit after 50% of requests fail
    resetTimeout: 3000, // Wait 30 seconds before trying to close the circuit
};

// Create circuit breakers for each service
const usersCircuit = new CircuitBreaker(async (url, options = {}) => {
    const response = await axios({
        url, 
        ...options,
        validateStatus: () => true
    });
    return { data: response.data, status: response.status };
}, circuitOptions);

const ordersCircuit = new CircuitBreaker(async (url, options = {}) => {
    const response = await axios({
        url, 
        ...options,
        validateStatus: () => true
    });
    return { data: response.data, status: response.status };
}, circuitOptions);

// Fallback functions
usersCircuit.fallback(() => ({error: 'Users service temporarily unavailable'}));
ordersCircuit.fallback(() => ({error: 'Orders service temporarily unavailable'}));

function authenticateJWT(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

    if (!token) {
        return res.status(401).json({
            success: false,
            error: { message: 'Access token is missing or invalid' }
        });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (jwtError) {
        return res.status(401).json({
            success: false,
            error: { message: 'Invalid or expired token' }
        });
    }
}

function requireRoles(allowedRoles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: { message: 'Authentication required' }
            });
        }

        if (!req.user.roles || !Array.isArray(req.user.roles)) {
            return res.status(403).json({
                success: false,
                error: { message: 'User roles not found' }
            });
        }

        const hasPermission = allowedRoles.some(role => req.user.roles.includes(role));

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                error: { 
                    message: `Access denied. Required roles: ${allowedRoles.join(', ')}` 
                }
            });
        }

        next();
    };
}

app.get(`${API_VERSION}/users/status`, async (req, res) => {
    try {
        const result = await usersCircuit.fire(`${USERS_SERVICE_URL}/users/status`);
        res.status(result.status).json(result.data);
    } catch (error) {
        res.status(500).json({error: 'Internal server error'});
    }
});

app.get(`${API_VERSION}/users/health`, async (req, res) => {
    try {
        const result = await usersCircuit.fire(`${USERS_SERVICE_URL}/users/health`);
        res.status(result.status).json(result.data);
    } catch (error) {
        res.status(500).json({error: 'Internal server error'});
    }
});

app.get(`${API_VERSION}/users/profile`, authenticateJWT, async (req, res) => {
    try {
        const result = await usersCircuit.fire(`${USERS_SERVICE_URL}/users/profile/${req.user.id}`);
        res.status(result.status).json(result.data);
    } catch (error) {
        res.status(500).json({error: 'Internal server error'});
    }
});

app.put(`${API_VERSION}/users/profile`, authenticateJWT, async (req, res) => {
    try {
        const result = await usersCircuit.fire(`${USERS_SERVICE_URL}/users/profile/${req.user.id}`, {
            method: 'PUT',
            data: req.body
        });
        res.status(result.status).json(result.data);
    } catch (error) {
        res.status(500).json({error: 'Internal server error'});
    }
});

app.get(`${API_VERSION}/users/:userId`, authenticateJWT, requireRoles(['Manager', 'Admin']), async (req, res) => {
    try {
        const result = await usersCircuit.fire(`${USERS_SERVICE_URL}/users/${req.params.userId}`);
        res.status(result.status).json(result.data);
    } catch (error) {
        res.status(500).json({error: 'Internal server error'});
    }
});

app.post(`${API_VERSION}/users`, authenticateJWT, requireRoles(['Admin']), async (req, res) => {
    try {
        const result = await usersCircuit.fire(`${USERS_SERVICE_URL}/users`, {
            method: 'POST',
            data: req.body
        });
        res.status(result.status).json(result.data);
    } catch (error) {
        res.status(500).json({error: 'Internal server error'});
    }
});

app.get(`${API_VERSION}/users`, authenticateJWT, requireRoles(['Manager', 'Admin']), async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            role,
            email,
            name,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        const pageNum = Math.max(1, parseInt(page, 10));
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));

        const queryParams = new URLSearchParams({
            page: pageNum.toString(),
            limit: limitNum.toString(),
            sortBy,
            sortOrder
        });

        if (role) queryParams.append('role', role);
        if (email) queryParams.append('email', email);
        if (name) queryParams.append('name', name);

        const url = `${USERS_SERVICE_URL}/users?${queryParams.toString()}`;
        
        logger.info({ 
            adminId: req.user.id,
            filters: { role, email, name },
            pagination: { page: pageNum, limit: limitNum },
            sorting: { sortBy, sortOrder }
        }, 'Admin fetching users list with filters');

        const result = await usersCircuit.fire(url);
        
        if (result.status === 200 && result.data) {
            const response = {
                success: true,
                data: result.data.users || result.data,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total: result.data.total || (result.data.users ? result.data.users.length : 0),
                    totalPages: result.data.totalPages || Math.ceil((result.data.total || 0) / limitNum)
                },
                filters: {
                    role: role || null,
                    email: email || null,
                    name: name || null
                },
                sorting: {
                    sortBy,
                    sortOrder
                }
            };
            
            res.status(200).json(response);
        } else {
            res.status(result.status).json(result.data);
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

app.delete(`${API_VERSION}/users/:userId`, authenticateJWT, requireRoles(['Admin']), async (req, res) => {
    try {
        const result = await usersCircuit.fire(`${USERS_SERVICE_URL}/users/${req.params.userId}`, {
            method: 'DELETE'
        });
        res.status(result.status).json(result.data);
    } catch (error) {
        res.status(500).json({error: 'Internal server error'});
    }
});

app.put(`${API_VERSION}/users/:userId`, authenticateJWT, requireRoles(['Admin']), async (req, res) => {
    try {
        const result = await usersCircuit.fire(`${USERS_SERVICE_URL}/users/${req.params.userId}`, {
            method: 'PUT',
            data: req.body
        });
        res.status(result.status).json(result.data);
    } catch (error) {
        res.status(500).json({error: 'Internal server error'});
    }
});

app.post(`${API_VERSION}/users/register`, authLimiter, async (req, res) => {
    try {
        const result = await usersCircuit.fire(`${USERS_SERVICE_URL}/users/register`, {
            method: 'POST',
            data: req.body
        });
        res.status(result.status).json(result.data);
    } catch (error) {
        res.status(500).json({error: 'Internal server error'});
    }
});

app.post(`${API_VERSION}/users/login`, authLimiter, async (req, res) => {
    try {
        const result = await usersCircuit.fire(`${USERS_SERVICE_URL}/users/login`, {
            method: 'POST',
            data: req.body
        });
        res.status(result.status).json(result.data);
    } catch (error) {
        res.status(500).json({error: 'Internal server error'});
    }
});

app.get(`${API_VERSION}/orders/health`, async (req, res) => {
    try {
        const result = await ordersCircuit.fire(`${ORDERS_SERVICE_URL}/orders/health`);
        res.status(result.status).json(result.data);
    } catch (error) {
        res.status(500).json({error: 'Internal server error'});
    }
});

app.get(`${API_VERSION}/orders/status`, async (req, res) => {
    try {
        const result = await ordersCircuit.fire(`${ORDERS_SERVICE_URL}/orders/status`);
        res.status(result.status).json(result.data);
    } catch (error) {
        res.status(500).json({error: 'Internal server error'});
    }
});

app.get(`${API_VERSION}/orders/my`, authenticateJWT, async (req, res) => {
    try {
        const queryParams = new URLSearchParams();
        if (req.query.page) queryParams.append('page', req.query.page);
        if (req.query.limit) queryParams.append('limit', req.query.limit);
        if (req.query.sortBy) queryParams.append('sortBy', req.query.sortBy);
        if (req.query.sortOrder) queryParams.append('sortOrder', req.query.sortOrder);
        if (req.query.status) queryParams.append('status', req.query.status);
        
        const queryString = queryParams.toString();
        const url = `${ORDERS_SERVICE_URL}/orders/user/${req.user.id}${queryString ? '?' + queryString : ''}`;
        
        const result = await ordersCircuit.fire(url);
        res.status(result.status).json(result.data);
    } catch (error) {
        res.status(500).json({error: 'Internal server error'});
    }
});

app.get(`${API_VERSION}/orders/:orderId`, authenticateJWT, requireRoles(['Engineer', 'Manager', 'Admin']), async (req, res) => {
    try {
        const result = await ordersCircuit.fire(`${ORDERS_SERVICE_URL}/orders/${req.params.orderId}`);
        res.status(result.status).json(result.data);
    } catch (error) {
        res.status(500).json({error: 'Internal server error'});
    }
});

app.post(`${API_VERSION}/orders`, authenticateJWT, requireRoles(['Customer', 'Manager', 'Admin']), async (req, res) => {
    try {
        const result = await ordersCircuit.fire(`${ORDERS_SERVICE_URL}/orders`, {
            method: 'POST',
            data: req.body
        });
        
        if (result.status === 201 && result.data && result.data.success) {
            try {
                const orderData = result.data.data || result.data;
                const orderCreatedEvent = new OrderCreatedEvent({
                    id: orderData.id,
                    userId: req.user.id,
                    items: orderData.items || req.body.items,
                    totalAmount: orderData.totalAmount,
                    status: orderData.status || 'pending',
                    createdAt: orderData.createdAt || new Date().toISOString()
                });
                
                await eventPublisher.publish(orderCreatedEvent);
            } catch (eventError) {
                logger.error('Failed to publish order created event:', eventError);
            }
        }
        
        res.status(result.status).json(result.data);
    } catch (error) {
        res.status(500).json({error: 'Internal server error'});
    }
});

app.get(`${API_VERSION}/orders`, authenticateJWT, requireRoles(['Engineer', 'Manager', 'Admin']), async (req, res) => {
    try {
        const result = await ordersCircuit.fire(`${ORDERS_SERVICE_URL}/orders`);
        res.status(result.status).json(result.data);
    } catch (error) {
        res.status(500).json({error: 'Internal server error'});
    }
});

app.delete(`${API_VERSION}/orders/:orderId`, authenticateJWT, requireRoles(['Manager', 'Admin']), async (req, res) => {
    try {
        const result = await ordersCircuit.fire(`${ORDERS_SERVICE_URL}/orders/${req.params.orderId}`, {
            method: 'DELETE'
        });
        res.status(result.status).json(result.data);
    } catch (error) {
        res.status(500).json({error: 'Internal server error'});
    }
});

app.patch(`${API_VERSION}/orders/:orderId/status`, authenticateJWT, requireRoles(['Engineer', 'Manager', 'Admin']), async (req, res) => {
    try {
        const orderId = req.params.orderId;
        const newStatus = req.body.status;
        
        let oldStatus = null;
        try {
            const currentOrderResult = await ordersCircuit.fire(`${ORDERS_SERVICE_URL}/orders/${orderId}`);
            if (currentOrderResult.status === 200 && currentOrderResult.data) {
                const orderData = currentOrderResult.data.data || currentOrderResult.data;
                oldStatus = orderData.status;
            }
        } catch (error) {
            logger.warn('Could not fetch current order status for event:', error.message);
        }
        
        const result = await ordersCircuit.fire(`${ORDERS_SERVICE_URL}/orders/${orderId}/status`, {
            method: 'PATCH',
            data: req.body
        });
        
        if (result.status === 200 && result.data && result.data.success) {
            try {
                const statusUpdatedEvent = new OrderStatusUpdatedEvent(
                    orderId,
                    oldStatus,
                    newStatus,
                    req.user.id
                );
                
                await eventPublisher.publish(statusUpdatedEvent);
            } catch (eventError) {
                logger.error('Failed to publish order status updated event:', eventError);
            }
        }
        
        res.status(result.status).json(result.data);
    } catch (error) {
        res.status(500).json({error: 'Internal server error'});
    }
});

app.patch(`${API_VERSION}/orders/:orderId/cancel`, authenticateJWT, requireRoles(['Manager', 'Admin']), async (req, res) => {
    try {
        const orderId = req.params.orderId;
        
        const result = await ordersCircuit.fire(`${ORDERS_SERVICE_URL}/orders/${orderId}/cancel`, {
            method: 'PATCH'
        });
        
        if (result.status === 200 && result.data && result.data.success) {
            try {
                const orderCancelledEvent = new OrderCancelledEvent(
                    orderId,
                    req.body.reason || 'Cancelled by admin/manager',
                    req.user.id
                );
                
                await eventPublisher.publish(orderCancelledEvent);
            } catch (eventError) {
                logger.error('Failed to publish order cancelled event:', eventError);
            }
        }
        
        res.status(result.status).json(result.data);
    } catch (error) {
        res.status(500).json({error: 'Internal server error'});
    }
});

app.put(`${API_VERSION}/orders/:orderId`, authenticateJWT, requireRoles(['Manager', 'Admin']), async (req, res) => {
    try {
        const result = await ordersCircuit.fire(`${ORDERS_SERVICE_URL}/orders/${req.params.orderId}`, {
            method: 'PUT',
            data: req.body
        });
        res.status(result.status).json(result.data);
    } catch (error) {
        res.status(500).json({error: 'Internal server error'});
    }
});

// Gateway Aggregation: Get user details with their orders
app.get(`${API_VERSION}/users/:userId/details`, authenticateJWT, requireRoles(['Manager', 'Admin']), async (req, res) => {
    try {
        const userId = req.params.userId;

        // Get user details
        const userPromise = usersCircuit.fire(`${USERS_SERVICE_URL}/users/${userId}`);

        // Get user's orders (assuming orders have a userId field)
        const ordersPromise = ordersCircuit.fire(`${ORDERS_SERVICE_URL}/orders`);

        // Wait for both requests to complete
        const [userResult, ordersResult] = await Promise.all([userPromise, ordersPromise]);

        // If user not found, return 404
        if (userResult.status === 404) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        // Filter orders for this user
        const userOrders = ordersResult.data.data ? 
            ordersResult.data.data.filter(order => order.userId == userId) : [];

        // Return aggregated response in standard format
        res.json({
            success: true,
            data: {
                user: userResult.data,
                orders: userOrders
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// Health check endpoint that shows circuit breaker status
app.get(`${API_VERSION}/health`, (req, res) => {
    res.json({
        status: 'API Gateway is running',
        circuits: {
            users: {
                status: usersCircuit.status,
                stats: usersCircuit.stats
            },
            orders: {
                status: ordersCircuit.status,
                stats: ordersCircuit.stats
            }
        }
    });
});

app.get(`${API_VERSION}/status`, (req, res) => {
    res.json({status: 'API Gateway is running'});
});

// Start server
app.listen(PORT, () => {
    logger.info(`API Gateway running on port ${PORT}`);

    // Log circuit breaker events for monitoring
    usersCircuit.on('open', () => logger.warn('Users circuit breaker opened'));
    usersCircuit.on('close', () => logger.info('Users circuit breaker closed'));
    usersCircuit.on('halfOpen', () => logger.info('Users circuit breaker half-open'));

    ordersCircuit.on('open', () => logger.warn('Orders circuit breaker opened'));
    ordersCircuit.on('close', () => logger.info('Orders circuit breaker closed'));
    ordersCircuit.on('halfOpen', () => logger.info('Orders circuit breaker half-open'));
});