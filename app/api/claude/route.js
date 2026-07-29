import { NextResponse } from 'next/server';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const body = await request.json();

    // Add stream:true to the request
    body.stream = true;

    // Build headers — add web search beta header if tools include web_search
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    };
    if (body.tools?.some(t => t.type?.startsWith('web_search'))) {
      headers['anthropic-beta'] = 'web-search-2025-03-05';
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errData = await response.json();
      return NextResponse.json(errData, { status: response.status });
    }

    // Stream the response through — keeps Vercel connection alive
    return new Response(response.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
