const express = require('express');
const cors = require('cors');
const { z } = require('zod');

const app = express();
const PORT = process.env.PORT || 8000;

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

let fakeUsersDb = {};
let currentId = 1;

function createUserModel(userData) {
    const now = new Date().toISOString();
    const userId = currentId++;
    
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

// Routes
app.get('/users', (req, res) => {
    const users = Object.values(fakeUsersDb).map(sanitizeUser);
    res.json(users);
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