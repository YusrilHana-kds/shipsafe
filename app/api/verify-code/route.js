import { NextResponse } from 'next/server';

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = process.env.AIRTABLE_BASE_ID;
const TABLE_NAME = 'Waitlist';

export async function POST(request) {
  const { code } = await request.json();

  if (!code) {
    return NextResponse.json({ valid: false, error: 'No code provided' }, { status: 400 });
  }

  const formula = `AND({Access Code}="${code.trim().toUpperCase()}",{Status}="Approved")`;
  const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_NAME}?filterByFormula=${encodeURIComponent(formula)}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
  });

  if (!res.ok) {
    return NextResponse.json({ valid: false, error: 'Airtable error' }, { status: 500 });
  }

  const data = await res.json();
  const valid = Array.isArray(data.records) && data.records.length > 0;

  return NextResponse.json({ valid });
}

export async function GET() {
  return NextResponse.json({ status: 'ok' });
}
