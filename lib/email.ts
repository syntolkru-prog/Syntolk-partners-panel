import { Resend } from "resend";
import { prisma } from "@/lib/prisma";

function client() {
  const key = process.env.RESEND_API_KEY;
  return key ? new Resend(key) : null;
}

function replaceVars(value: string, vars: Record<string,string|number>) {
  return value.replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars[key] ?? `{{${key}}}`));
}

export async function sendTemplatedEmail(input: {
  type: string;
  to: string;
  recipientId?: string | null;
  variables?: Record<string,string|number>;
  fallbackSubject: string;
  fallbackBody: string;
}) {
  const vars = input.variables ?? {};
  const template = await prisma.emailTemplate.findFirst({
    where: { type: input.type as any, isActive: true },
  });

  const subject = replaceVars(template?.subject ?? input.fallbackSubject, vars);
  const body = replaceVars(template?.body ?? input.fallbackBody, vars);
  const log = await prisma.emailLog.create({
    data: {
      templateId: template?.id,
      recipientId: input.recipientId,
      recipientEmail: input.to,
      subject,
      body,
      status: "PENDING",
    },
  });

  const resend = client();
  if (!resend) {
    await prisma.emailLog.update({ where: { id: log.id }, data: { status: "FAILED", error: "RESEND_API_KEY not configured" } });
    return { success: false, reason: "email_not_configured" };
  }

  try {
    const result = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || "Syntolk Partners <noreply@syntolk.ru>",
      to: input.to,
      subject,
      html: body,
    });
    await prisma.emailLog.update({
      where: { id: log.id },
      data: { status: "SENT", sentAt: new Date(), providerId: result.data?.id ?? null },
    });
    return { success: true };
  } catch (error) {
    await prisma.emailLog.update({
      where: { id: log.id },
      data: { status: "FAILED", error: error instanceof Error ? error.message : "email_error" },
    });
    return { success: false };
  }
}
