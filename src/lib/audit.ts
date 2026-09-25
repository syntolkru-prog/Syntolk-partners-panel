import { prisma } from './prisma';

/**
 * Consistently logs administrative actions to the AuditLog table.
 */
export async function logAuditAction(data: {
    actorId: string;
    action: string;
    objectType: string;
    objectId: string;
    payload?: any;
}) {
    try {
        return await prisma.auditLog.create({
            data: {
                actorId: data.actorId,
                action: data.action,
                objectType: data.objectType,
                objectId: data.objectId,
                payload: data.payload || {},
            },
        });
    } catch (error) {
        console.error('Failed to log audit action:', error);
        // We don't want to fail the main action if auditing fails, 
        // but in a production app you might want more robust handling.
    }
}
