const express = require('express');
const cors = require('cors');
const axios = require('axios');
const CircuitBreaker = require('opossum');
const jwt = require('jsonwebtoken');
const pino = require('pino');

const logger = pino({
    level: process.env.LOG_LEVEL || 'info'
});

const app = express();
const PORT = process.env.PORT || 8000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

// Middleware
app.use(cors());
app.use(express.json());

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

app.get(`${API_VERSION}/users/:userId`, async (req, res) => {
    try {
        const result = await usersCircuit.fire(`${USERS_SERVICE_URL}/users/${req.params.userId}`);
        res.status(result.status).json(result.data);
    } catch (error) {
        res.status(500).json({error: 'Internal server error'});
    }
});

app.post(`${API_VERSION}/users`, async (req, res) => {
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

app.get(`${API_VERSION}/users`, async (req, res) => {
    try {
        const result = await usersCircuit.fire(`${USERS_SERVICE_URL}/users`);
        res.status(result.status).json(result.data);
    } catch (error) {
        res.status(500).json({error: 'Internal server error'});
    }
});

app.delete(`${API_VERSION}/users/:userId`, async (req, res) => {
    try {
        const result = await usersCircuit.fire(`${USERS_SERVICE_URL}/users/${req.params.userId}`, {
            method: 'DELETE'
        });
        res.status(result.status).json(result.data);
    } catch (error) {
        res.status(500).json({error: 'Internal server error'});
    }
});

app.put(`${API_VERSION}/users/:userId`, async (req, res) => {
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

app.post(`${API_VERSION}/users/register`, async (req, res) => {
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

app.post(`${API_VERSION}/users/login`, async (req, res) => {
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

app.get(`${API_VERSION}/orders/:orderId`, async (req, res) => {
    try {
        const order = await ordersCircuit.fire(`${ORDERS_SERVICE_URL}/orders/${req.params.orderId}`);
        if (order.error === 'Order not found') {
            res.status(404).json(order);
        } else {
            res.json(order);
        }
    } catch (error) {
        res.status(500).json({error: 'Internal server error'});
    }
});

app.post(`${API_VERSION}/orders`, async (req, res) => {
    try {
        const order = await ordersCircuit.fire(`${ORDERS_SERVICE_URL}/orders`, {
            method: 'POST',
            data: req.body
        });
        res.status(201).json(order);
    } catch (error) {
        res.status(500).json({error: 'Internal server error'});
    }
});

app.get(`${API_VERSION}/orders`, async (req, res) => {
    try {
        const orders = await ordersCircuit.fire(`${ORDERS_SERVICE_URL}/orders`);
        res.json(orders);
    } catch (error) {
        res.status(500).json({error: 'Internal server error'});
    }
});

app.delete(`${API_VERSION}/orders/:orderId`, async (req, res) => {
    try {
        const result = await ordersCircuit.fire(`${ORDERS_SERVICE_URL}/orders/${req.params.orderId}`, {
            method: 'DELETE'
        });
        res.json(result);
    } catch (error) {
        res.status(500).json({error: 'Internal server error'});
    }
});

app.put(`${API_VERSION}/orders/:orderId`, async (req, res) => {
    try {
        const order = await ordersCircuit.fire(`${ORDERS_SERVICE_URL}/orders/${req.params.orderId}`, {
            method: 'PUT',
            data: req.body
        });
        res.json(order);
    } catch (error) {
        res.status(500).json({error: 'Internal server error'});
    }
});

app.get(`${API_VERSION}/orders/status`, async (req, res) => {
    try {
        const status = await ordersCircuit.fire(`${ORDERS_SERVICE_URL}/orders/status`);
        res.json(status);
    } catch (error) {
        res.status(500).json({error: 'Internal server error'});
    }
});

app.get(`${API_VERSION}/orders/health`, async (req, res) => {
    try {
        const health = await ordersCircuit.fire(`${ORDERS_SERVICE_URL}/orders/health`);
        res.json(health);
    } catch (error) {
        res.status(500).json({error: 'Internal server error'});
    }
});

// Gateway Aggregation: Get user details with their orders
app.get(`${API_VERSION}/users/:userId/details`, async (req, res) => {
    try {
        const userId = req.params.userId;

        // Get user details
        const userPromise = usersCircuit.fire(`${USERS_SERVICE_URL}/users/${userId}`);

        // Get user's orders (assuming orders have a userId field)
        const ordersPromise = ordersCircuit.fire(`${ORDERS_SERVICE_URL}/orders`)
            .then(orders => orders.filter(order => order.userId == userId));

        // Wait for both requests to complete
        const [user, userOrders] = await Promise.all([userPromise, ordersPromise]);

        // If user not found, return 404
        if (user.error === 'User not found') {
            return res.status(404).json(user);
        }

        // Return aggregated response
        res.json({
            user,
            orders: userOrders
        });
    } catch (error) {
        res.status(500).json({error: 'Internal server error'});
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