export async function onRequestPost(context) {
  const { env } = context;

  // Parse form data
  let data;
  const contentType = context.request.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    data = await context.request.json();
  } else {
    const formData = await context.request.formData();
    data = Object.fromEntries(formData);
  }

  // Validate required fields
  if (!data.first_name || !data.email) {
    return new Response(JSON.stringify({ error: 'First name and email are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Insert into D1
  try {
    await env.mind_agency_db.prepare(
      'INSERT INTO contacts (first_name, last_name, email, company, company_size, country, use_case, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      data.first_name || '',
      data.last_name || '',
      data.email || '',
      data.company || '',
      data.company_size || '',
      data.country || '',
      data.use_case || '',
      data.message || ''
    ).run();

    return new Response(JSON.stringify({ success: true, message: 'Thank you! We will get back to you soon.' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to save submission' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
