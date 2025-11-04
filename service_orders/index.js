const express = require('express');
const cors = require('cors');
const { z } = require('zod');

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json());

const ORDER_STATUS = {
    CREATED: 'created',
    IN_PROGRESS: 'in_progress', 
    COMPLETED: 'completed',
    CANCELLED: 'cancelled'
};

const StatusEnum = z.enum(['created', 'in_progress', 'completed', 'cancelled']);

const OrderItemSchema = z.object({
    productId: z.string().min(1, 'Product ID is required'),
    productName: z.string().min(1, 'Product name is required'),
    quantity: z.number().int().min(1, 'Quantity must be at least 1'),
    price: z.number().min(0, 'Price must be non-negative')
});

const createOrderSchema = z.object({
    userId: z.number().int().positive('User ID must be a positive integer'),
    items: z.array(OrderItemSchema).min(1, 'Order must contain at least one item'),
    totalAmount: z.number().min(0, 'Total amount must be non-negative').optional(),
    status: StatusEnum.default(ORDER_STATUS.CREATED)
});

const updateOrderSchema = z.object({
    items: z.array(OrderItemSchema).optional(),
    totalAmount: z.number().min(0, 'Total amount must be non-negative').optional(),
    status: StatusEnum.optional()
});

function createOrderModel(orderData) {
    const now = new Date().toISOString();
    
    const processedItems = processOrderItems(orderData.items);
    
    let totalAmount = orderData.totalAmount;
    if (!totalAmount) {
        totalAmount = processedItems.reduce((sum, item) => sum + item.subtotal, 0);
    }
    
    return {
        id: generateOrderId(),
        userId: orderData.userId,
        items: processedItems,
        status: orderData.status || ORDER_STATUS.CREATED,
        totalAmount: totalAmount,
        createdAt: now,
        updatedAt: now
    };
}

function updateOrderModel(existingOrder, updateData) {
    const updatedOrder = {
        ...existingOrder,
        ...updateData,
        updatedAt: new Date().toISOString()
    };
    
    if (updateData.items) {
        updatedOrder.items = processOrderItems(updateData.items);
        
        // Recalculate total amount if not provided
        if (!updateData.totalAmount) {
            updatedOrder.totalAmount = updatedOrder.items.reduce((sum, item) => sum + item.subtotal, 0);
        }
    }
    
    return updatedOrder;
}

function processOrderItems(items) {
    return items.map(item => ({
        ...item,
        subtotal: item.quantity * item.price
    }));
}

async function checkUserExists(userId) {
    try {
        const response = await fetch(`http://service_users:8000/users/${userId}`);
        return response.ok;
    } catch (error) {
        console.error('Error checking user existence:', error);
        return true;
    }
}

// Имитация базы данных в памяти (LocalStorage)
let fakeOrdersDb = {};
let currentId = 1;

function generateOrderId() {
    return currentId++;
}

// Routes
app.get('/orders/status', (req, res) => {
    res.json({status: 'Orders service is running'});
});

app.get('/orders/health', (req, res) => {
    res.json({
        status: 'OK',
        service: 'Orders Service',
        timestamp: new Date().toISOString()
    });
});

app.get('/orders/:orderId', (req, res) => {
    const orderId = req.params.orderId;
    const order = fakeOrdersDb[orderId];

    if (!order) {
        return res.status(404).json({
            success: false,
            error: 'Order not found'
        });
    }

    res.json({
        success: true,
        data: order
    });
});

app.get('/orders', (req, res) => {
    try {
        let orders = Object.values(fakeOrdersDb);

        if (req.query.userId) {
            const userId = parseInt(req.query.userId);
            orders = orders.filter(order => order.userId === userId);
        }

        if (req.query.status) {
            orders = orders.filter(order => order.status === req.query.status);
        }

        orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        res.json({
            success: true,
            data: orders
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

app.get('/orders/user/:userId', (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        let orders = Object.values(fakeOrdersDb).filter(order => order.userId === userId);

        if (req.query.status) {
            orders = orders.filter(order => order.status === req.query.status);
        }

        const sortBy = req.query.sortBy || 'createdAt';
        const sortOrder = req.query.sortOrder || 'desc';
        
        orders.sort((a, b) => {
            let valueA = a[sortBy];
            let valueB = b[sortBy];
            
            if (sortBy === 'createdAt' || sortBy === 'updatedAt') {
                valueA = new Date(valueA);
                valueB = new Date(valueB);
            }
            
            if (sortOrder === 'asc') {
                return valueA > valueB ? 1 : valueA < valueB ? -1 : 0;
            } else {
                return valueA < valueB ? 1 : valueA > valueB ? -1 : 0;
            }
        });

        const pageNum = Math.max(1, parseInt(req.query.page) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
        const startIndex = (pageNum - 1) * limitNum;
        const endIndex = startIndex + limitNum;

        const totalOrders = orders.length;
        const totalPages = Math.ceil(totalOrders / limitNum);
        const paginatedOrders = orders.slice(startIndex, endIndex);

        res.json({
            success: true,
            orders: paginatedOrders,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: totalOrders,
                totalPages
            },
            filters: {
                status: req.query.status || null
            },
            sorting: {
                sortBy,
                sortOrder
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

app.post('/orders', async (req, res) => {
    try {
        const validation = createOrderSchema.safeParse(req.body);
        
        if (!validation.success) {
            return res.status(400).json({ 
                success: false,
                error: 'Validation failed', 
                errors: validation.error.errors.map(err => ({
                    field: err.path.join('.'),
                    message: err.message
                }))
            });
        }

        const orderData = validation.data;
        
        const userExists = await checkUserExists(orderData.userId);
        if (!userExists) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        const newOrder = createOrderModel(orderData);
        
        fakeOrdersDb[newOrder.id] = newOrder;
        
        res.status(201).json({
            success: true,
            data: newOrder
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

app.put('/orders/:orderId', (req, res) => {
    try {
        const orderId = req.params.orderId;
        const existingOrder = fakeOrdersDb[orderId];

        if (!existingOrder) {
            return res.status(404).json({
                success: false,
                error: 'Order not found'
            });
        }

        const validation = updateOrderSchema.safeParse(req.body);
        
        if (!validation.success) {
            return res.status(400).json({ 
                success: false,
                error: 'Validation failed', 
                errors: validation.error.errors.map(err => ({
                    field: err.path.join('.'),
                    message: err.message
                }))
            });
        }

        const updateData = validation.data;
        const updatedOrder = updateOrderModel(existingOrder, updateData);
        
        fakeOrdersDb[orderId] = updatedOrder;
        
        res.json({
            success: true,
            data: updatedOrder
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

app.delete('/orders/:orderId', (req, res) => {
    try {
        const orderId = req.params.orderId;

        if (!fakeOrdersDb[orderId]) {
            return res.status(404).json({
                success: false,
                error: 'Order not found'
            });
        }

        const deletedOrder = fakeOrdersDb[orderId];
        delete fakeOrdersDb[orderId];

        res.json({
            success: true,
            message: 'Order deleted successfully',
            data: deletedOrder
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Orders service running on port ${PORT}`);
});