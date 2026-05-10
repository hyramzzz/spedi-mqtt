import { FastifyInstance } from 'fastify';
import { authService } from '../services/auth.service';
import { sessionService } from '../services/session.service';

const ErrorResponse = {
    type: 'object',
    properties: {
        error: { type: 'string' },
        message: { type: 'string' },
    },
};

const UserObject = {
    type: 'object',
    properties: {
        id: { type: 'string', format: 'uuid' },
        email: { type: 'string', format: 'email' },
        is_superuser: { type: 'boolean' },
    },
};

export default async function authRoutes(fastify: FastifyInstance) {
    // POST /auth/login
    fastify.post('/auth/login', {
        schema: {
            tags: ['Auth'],
            summary: 'Login with email and password',
            description: 'Authenticates a user via Supabase Auth and returns a JWT.',
            body: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                    email: { type: 'string', format: 'email', examples: ['dev@spedi.io'] },
                    password: { type: 'string', minLength: 1, examples: ['password'] },
                },
                examples: [{
                    email: 'dev@spedi.io',
                    password: 'password'
                }]
            },
            response: {
                200: {
                    type: 'object',
                    properties: {
                        user: UserObject,
                        session: {
                            type: 'object',
                            properties: {
                                access_token: { type: 'string' },
                                refresh_token: { type: 'string' },
                                expires_in: { type: 'number' },
                            },
                        },
                    },
                },
                400: ErrorResponse,
                401: ErrorResponse,
            },
        },
    }, async (request, reply) => {
        const { email, password } = request.body as any;

        if (!email || !password) {
            return reply.code(400).send({ error: 'Bad Request', message: 'Email and password are required' });
        }

        try {
            const data = await authService.login(email, password);
            return {
                user: {
                    id: data.user.id,
                    email: data.user.email,
                    is_superuser: data.user.app_metadata?.is_superuser === true
                },
                session: {
                    access_token: data.session.access_token,
                    refresh_token: data.session.refresh_token,
                    expires_in: data.session.expires_in
                }
            };
        } catch (err: any) {
            return reply.code(401).send({ error: 'Unauthorized', message: err.message });
        }
    });

    // POST /auth/logout
    fastify.post('/auth/logout', {
        preHandler: [(fastify as any).authenticate],
        schema: {
            tags: ['Auth'],
            summary: 'Logout',
            description: 'Signs the user out and closes any active control session. Publishes stop to the device.',
            security: [{ BearerAuth: [] }],
            response: {
                200: {
                    type: 'object',
                    properties: {
                        message: { type: 'string' },
                    },
                },
                500: ErrorResponse,
            },
        },
    }, async (request, reply) => {
        try {
            if (request.user) {
                sessionService.close(request.user.id, 'user_disconnect');
            }

            await authService.logout();
            return { message: 'Logged out successfully' };
        } catch (err: any) {
            return reply.code(500).send({ error: 'Internal Server Error', message: err.message });
        }
    });

    // GET /auth/me
    fastify.get('/auth/me', {
        preHandler: [(fastify as any).authenticate],
        schema: {
            tags: ['Auth'],
            summary: 'Get current user',
            description: 'Returns the authenticated user profile.',
            security: [{ BearerAuth: [] }],
            response: {
                200: UserObject,
            },
        },
    }, async (request) => {
        return request.user;
    });
}
