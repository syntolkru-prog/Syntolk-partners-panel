import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET: List active resources for affiliates
export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id')!;
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || user.role !== 'AFFILIATE') {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const resources = await prisma.resource.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      success: true,
      resources: resources.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        type: r.type,
        fileUrl: r.fileUrl,
        fileName: r.fileName,
        fileSize: r.fileSize,
        mimeType: r.mimeType,
        category: r.category,
        downloads: r.downloads,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('Affiliate resources API error:', error);
    return NextResponse.json({ error: 'Failed to fetch resources' }, { status: 500 });
  }
}

// POST: Track download (increment counter)
export async function POST(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id')!;
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || user.role !== 'AFFILIATE') {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Resource ID required' }, { status: 400 });
    }

    await prisma.resource.update({
      where: { id },
      data: { downloads: { increment: 1 } },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Track download error:', error);
    return NextResponse.json({ error: 'Failed to track download' }, { status: 500 });
  }
}
