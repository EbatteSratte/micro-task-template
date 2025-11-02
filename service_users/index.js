const express = require('express');
const cors = require('cors');
const { z } = require('zod');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 8000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

// Middleware
app.use(cors());
app.use(express.json());

const ROLES = {
    CUSTOMER: 'Customer',
    ENGINEER: 'Engineer',
    MANAGER: 'Manager',
    ADMIN: 'Admin'
};

const RoleEnum = z.enum(['Customer', 'Engineer', 'Manager', 'Admin']);

const createUserSchema = z.object({
    email: z.string().email('Invalid email format'),
    password: z.string().min(1, 'Password is required').optional(),
    passwordHash: z.string().min(1, 'Password is required').optional(),
    name: z.string().min(1, 'Name is required'),
    roles: z.array(RoleEnum).default([ROLES.CUSTOMER])
}).refine(data => data.password || data.passwordHash, {
    message: 'Either password or passwordHash is required',
    path: ['password']
});

const updateUserSchema = z.object({
    email: z.string().email('Invalid email format').optional(),
    password: z.string().min(1).optional(),
    passwordHash: z.string().min(1).optional(),
    name: z.string().min(1, 'Name cannot be empty').optional(),
    roles: z.array(RoleEnum).optional()
});

const registerSchema = z.object({
    email: z.string().email('Invalid email format'),
    password: z.string().min(1, 'Password is required'),
    name: z.string().min(1, 'Name is required')
});

const loginSchema = z.object({
    email: z.string().email('Invalid email format'),
    password: z.string().min(1, 'Password is required')
});

const updateProfileSchema = z.object({
    email: z.string().email('Invalid email format').optional(),
    name: z.string().min(1, 'Name cannot be empty').optional()
});

let fakeUsersDb = {};
let currentId = 1;

function generateUserId() {
    return currentId++;
}

function createUserModel(userData) {
    const now = new Date().toISOString();
    const userId = generateUserId();
    
    return {
        id: userId,
        email: userData.email,
        passwordHash: userData.passwordHash || userData.password,
        name: userData.name,
        roles: userData.roles || [ROLES.CUSTOMER],
        createdAt: now,
        updatedAt: now
    };
}

function updateUserModel(existingUser, updates) {
    const now = new Date().toISOString();
    
    return {
        ...existingUser,
        email: updates.email !== undefined ? updates.email : existingUser.email,
        passwordHash: updates.passwordHash !== undefined ? updates.passwordHash : existingUser.passwordHash,
        name: updates.name !== undefined ? updates.name : existingUser.name,
        roles: updates.roles !== undefined ? updates.roles : existingUser.roles,
        updatedAt: now
    };
}

function sanitizeUser(user) {
    const { passwordHash, ...safeUser } = user;
    return safeUser;
}

function generateJwtForUser(user) {
    const payload = { id: user.id, roles: user.roles };
    return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
}

app.post('/users/register', (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            success: false,
            error: {
                message: 'Validation failed',
                details: parsed.error.errors.map(err => ({ field: err.path.join('.'), message: err.message }))
            }
        });
    }

    const { email, password, name } = parsed.data;

    const exists = Object.values(fakeUsersDb).find(u => u.email === email);
    if (exists) {
        return res.status(409).json({
            success: false,
            error: { message: 'User with this email already exists' }
        });
    }

    const newUser = createUserModel({ email, password, name, roles: [ROLES.CUSTOMER] });
    fakeUsersDb[newUser.id] = newUser;

    const token = generateJwtForUser(newUser);

    return res.status(201).json({
        success: true,
        data: {
            token,
            user: sanitizeUser(newUser)
        }
    });
});

app.post('/users/login', (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            success: false,
            error: {
                message: 'Validation failed',
                details: parsed.error.errors.map(err => ({ field: err.path.join('.'), message: err.message }))
            }
        });
    }

    const { email, password } = parsed.data;
    const user = Object.values(fakeUsersDb).find(u => u.email === email);

    if (!user || user.passwordHash !== password) {
        return res.status(401).json({
            success: false,
            error: { message: 'Invalid email or password' }
        });
    }

    const token = generateJwtForUser(user);
    return res.json({
        success: true,
        data: {
            token,
            user: sanitizeUser(user)
        }
    });
});

app.get('/users/profile/:userId', (req, res) => {
    const userId = parseInt(req.params.userId);
    
    const user = fakeUsersDb[userId];
    
    if (!user) {
        return res.status(404).json({
            success: false,
            error: { message: 'User not found' }
        });
    }
    
    res.json({
        success: true,
        data: { 
            user: sanitizeUser(user) 
        }
    });
});

app.put('/users/profile/:userId', (req, res) => {
    const userId = parseInt(req.params.userId);
    const user = fakeUsersDb[userId];
    
    if (!user) {
        return res.status(404).json({
            success: false,
            error: { message: 'User not found' }
        });
    }
    
    const validation = updateProfileSchema.safeParse(req.body);
    
    if (!validation.success) {
        return res.status(400).json({
            success: false,
            error: {
                message: 'Validation failed',
                details: validation.error.errors.map(err => ({
                    field: err.path.join('.'),
                    message: err.message
                }))
            }
        });
    }
    
    const updates = validation.data;
    
    if (updates.email) {
        const existingUser = Object.values(fakeUsersDb).find(
            u => u.email === updates.email && u.id !== userId
        );
        if (existingUser) {
            return res.status(409).json({
                success: false,
                error: { message: 'User with this email already exists' }
            });
        }
    }
    
    const updatedUser = {
        ...user,
        email: updates.email !== undefined ? updates.email : user.email,
        name: updates.name !== undefined ? updates.name : user.name,
        updatedAt: new Date().toISOString()
    };
    
    fakeUsersDb[userId] = updatedUser;
    
    res.json({
        success: true,
        data: {
            user: sanitizeUser(updatedUser)
        }
    });
});

app.get('/users', (req, res) => {
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

        let users = Object.values(fakeUsersDb);

        if (role) {
            users = users.filter(user => user.roles && user.roles.includes(role));
        }

        if (email) {
            users = users.filter(user => 
                user.email.toLowerCase().includes(email.toLowerCase())
            );
        }

        if (name) {
            users = users.filter(user => 
                user.name.toLowerCase().includes(name.toLowerCase())
            );
        }

        users.sort((a, b) => {
            let aValue = a[sortBy];
            let bValue = b[sortBy];

            if (sortBy === 'createdAt' || sortBy === 'updatedAt') {
                aValue = new Date(aValue);
                bValue = new Date(bValue);
            }

            if (typeof aValue === 'string') {
                aValue = aValue.toLowerCase();
                bValue = bValue.toLowerCase();
            }

            if (sortOrder === 'desc') {
                return bValue > aValue ? 1 : bValue < aValue ? -1 : 0;
            } else {
                return aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
            }
        });

        const pageNum = Math.max(1, parseInt(page, 10));
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
        const startIndex = (pageNum - 1) * limitNum;
        const endIndex = startIndex + limitNum;

        const totalUsers = users.length;
        const totalPages = Math.ceil(totalUsers / limitNum);
        const paginatedUsers = users.slice(startIndex, endIndex);

        const sanitizedUsers = paginatedUsers.map(sanitizeUser);

        res.json({
            success: true,
            users: sanitizedUsers,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: totalUsers,
                totalPages
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
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

app.post('/users', (req, res) => {
    const validation = createUserSchema.safeParse(req.body);
    
    if (!validation.success) {
        return res.status(400).json({ 
            error: 'Validation failed', 
            errors: validation.error.errors.map(err => ({
                field: err.path.join('.'),
                message: err.message
            }))
        });
    }
    
    const userData = validation.data;
    
    const existingUser = Object.values(fakeUsersDb).find(u => u.email === userData.email);
    if (existingUser) {
        return res.status(409).json({ error: 'User with this email already exists' });
    }
    
    const newUser = createUserModel(userData);
    fakeUsersDb[newUser.id] = newUser;
    
    res.status(201).json(sanitizeUser(newUser));
});

app.get('/users/health', (req, res) => {
    res.json({
        status: 'OK',
        service: 'Users Service',
        timestamp: new Date().toISOString()
    });
});

app.get('/users/status', (req, res) => {
    res.json({status: 'Users service is running'});
});

app.get('/users/:userId', (req, res) => {
    const userId = parseInt(req.params.userId);
    const user = fakeUsersDb[userId];

    if (!user) {
        return res.status(404).json({error: 'User not found'});
    }

    res.json(sanitizeUser(user));
});

app.put('/users/:userId', (req, res) => {
    const userId = parseInt(req.params.userId);

    if (!fakeUsersDb[userId]) {
        return res.status(404).json({error: 'User not found'});
    }
    
    const validation = updateUserSchema.safeParse(req.body);
    
    if (!validation.success) {
        return res.status(400).json({ 
            error: 'Validation failed', 
            errors: validation.error.errors.map(err => ({
                field: err.path.join('.'),
                message: err.message
            }))
        });
    }
    
    const updates = validation.data;
    
    if (updates.email) {
        const existingUser = Object.values(fakeUsersDb).find(
            u => u.email === updates.email && u.id !== userId
        );
        if (existingUser) {
            return res.status(409).json({ error: 'User with this email already exists' });
        }
    }

    const updatedUser = updateUserModel(fakeUsersDb[userId], updates);
    fakeUsersDb[userId] = updatedUser;
    
    res.json(sanitizeUser(updatedUser));
});

app.delete('/users/:userId', (req, res) => {
    const userId = parseInt(req.params.userId);

    if (!fakeUsersDb[userId]) {
        return res.status(404).json({error: 'User not found'});
    }

    const deletedUser = fakeUsersDb[userId];
    delete fakeUsersDb[userId];

    res.json({message: 'User deleted', user: sanitizeUser(deletedUser)});
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Users service running on port ${PORT}`);
});