import { NextResponse } from 'next/server';

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = process.env.AIRTABLE_BASE_ID;
const TABLE_NAME = 'Waitlist';

export async function POST(request) {
  const { name, email, exportInfo, frequency } = await request.json();

  if (!name || !email) {
    return NextResponse.json({ success: false, error: 'Name and email are required' }, { status: 400 });
  }

  const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_NAME}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${AIRTABLE_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fields: {
        Name: name,
        Email: email,
        'Export Info': exportInfo || '',
      },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return NextResponse.json({ success: false, error: err?.error?.message || 'Airtable error' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function GET() {
  return NextResponse.json({ status: 'ok' });
}
