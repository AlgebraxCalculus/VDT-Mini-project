/**
 * DI token for the shared ioredis command client. Most consumers should inject
 * {@link RedisService} instead — this token exists for the rare case where a raw
 * client is needed (and for the service's own provider wiring).
 */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');
