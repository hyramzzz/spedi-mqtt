"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = userRoutes;
const user_service_1 = require("../services/user.service");
const UserResponseSchema = {
    type: 'object',
    properties: {
        id: { type: 'string', format: 'uuid', example: 'd3b07384-d990-4e92-a034-927395c966f3' },
        email: { type: 'string', format: 'email', example: 'standard-user@spedi.io' },
        is_superuser: { type: 'boolean', example: false },
        created_at: { type: 'string', format: 'date-time', example: '2024-03-20T14:30:00.000Z' },
    },
};
const ErrorResponse = {
    type: 'object',
    properties: {
        error: { type: 'string' },
    },
};
async function userRoutes(fastify) {
    /**
     * GET /users
     */
    fastify.get('/users', {
        onRequest: [fastify.authenticate],
        schema: {
            tags: ['Users'],
            summary: 'List all users',
            description: 'Returns a list of all authentication users in the system. Restricted to superusers.',
            security: [{ BearerAuth: [] }],
            response: {
                200: {
                    type: 'array',
                    items: UserResponseSchema,
                },
                403: ErrorResponse,
            },
        },
    }, async (request, reply) => {
        const user = request.user;
        if (!user || !user.is_superuser) {
            return reply.status(403).send({ error: 'Forbidden: Superuser access required' });
        }
        return await user_service_1.userService.listUsers();
    });
    /**
     * POST /users
     */
    fastify.post('/users', {
        onRequest: [fastify.authenticate],
        schema: {
            tags: ['Users'],
            summary: 'Create standard user',
            description: 'Creates a new standard authentication user. Cannot be used to create superusers.',
            security: [{ BearerAuth: [] }],
            body: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                    email: { type: 'string', example: 'newuser@example.com' },
                    password: { type: 'string', example: 'TemporaryPassword123!' },
                },
            },
            response: {
                201: UserResponseSchema,
                403: ErrorResponse,
                400: ErrorResponse,
            },
        },
    }, async (request, reply) => {
        const user = request.user;
        if (!user || !user.is_superuser) {
            return reply.status(403).send({ error: 'Forbidden: Superuser access required' });
        }
        const { email, password } = request.body;
        try {
            const newUser = await user_service_1.userService.createUser(email, password);
            return reply.status(201).send(newUser);
        }
        catch (err) {
            return reply.status(400).send({ error: err.message });
        }
    });
    /**
     * PUT /users/:id
     */
    fastify.put('/users/:id', {
        onRequest: [fastify.authenticate],
        schema: {
            tags: ['Users'],
            summary: 'Update user',
            description: 'Updates a users email or password. Superuser status cannot be modified.',
            security: [{ BearerAuth: [] }],
            params: {
                type: 'object',
                properties: {
                    id: { type: 'string' }
                }
            },
            body: {
                type: 'object',
                properties: {
                    email: { type: 'string', example: 'updated@example.com' },
                    password: { type: 'string', example: 'NewSecurityKey1!' },
                },
            },
            response: {
                200: { type: 'object', properties: { ok: { type: 'boolean' } } },
                403: ErrorResponse,
                400: ErrorResponse,
            },
        },
    }, async (request, reply) => {
        const user = request.user;
        if (!user || !user.is_superuser) {
            return reply.status(403).send({ error: 'Forbidden: Superuser access required' });
        }
        const { id } = request.params;
        const body = request.body;
        try {
            await user_service_1.userService.updateUser(id, body);
            return { ok: true };
        }
        catch (err) {
            return reply.status(400).send({ error: err.message });
        }
    });
    /**
     * DELETE /users/:id
     */
    fastify.delete('/users/:id', {
        onRequest: [fastify.authenticate],
        schema: {
            tags: ['Users'],
            summary: 'Delete user',
            description: 'Permanently deletes a user account.',
            security: [{ BearerAuth: [] }],
            params: {
                type: 'object',
                properties: {
                    id: { type: 'string' }
                }
            },
            response: {
                200: { type: 'object', properties: { ok: { type: 'boolean' } } },
                403: ErrorResponse,
                400: ErrorResponse,
            },
        },
    }, async (request, reply) => {
        const user = request.user;
        if (!user || !user.is_superuser) {
            return reply.status(403).send({ error: 'Forbidden: Superuser access required' });
        }
        const { id } = request.params;
        // Prevent self-deletion if they happen to try it
        if (id === user.id) {
            return reply.status(400).send({ error: 'Cannot delete your own superuser account via the API' });
        }
        try {
            await user_service_1.userService.deleteUser(id);
            return { ok: true };
        }
        catch (err) {
            return reply.status(400).send({ error: err.message });
        }
    });
}
