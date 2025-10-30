/**
 * Test the exact fetch that Gradio client makes
 */

const spaceName = 'neiltron/vggt';
const token = process.env.HF_TOKEN;

if (!token) {
  console.error('HF_TOKEN not set');
  process.exit(1);
}

console.log(`Testing fetch to: https://huggingface.co/api/spaces/${spaceName}/host`);
console.log(`Token: ${token.substring(0, 7)}...`);
console.log('');

const headers = {};
if (token) {
  headers.Authorization = `Bearer ${token}`;
}

console.log('Headers:', headers);
console.log('');

try {
  const res = await fetch(
    `https://huggingface.co/api/spaces/${spaceName}/host`,
    { headers }
  );

  console.log('Response status:', res.status);
  console.log('Response headers:', Object.fromEntries(res.headers.entries()));
  console.log('');

  const text = await res.text();
  console.log('Response text:', text);
  console.log('');

  const data = JSON.parse(text);
  console.log('Parsed JSON:', data);
  console.log('');

  console.log('Host value:', data.host);

  if (data.host) {
    console.log('✅ Success! Host URL retrieved:', data.host);
  } else {
    console.log('❌ No host property in response');
  }

} catch (error) {
  console.error('❌ Fetch failed');
  console.error('Error:', error);
  console.error('Stack:', error.stack);
}
