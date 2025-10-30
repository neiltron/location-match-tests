/**
 * Diagnostic Script: Query VGGT API to find correct endpoint
 */

import { Client } from '@gradio/client';

async function main() {
  console.log('🔍 Diagnosing VGGT API...\n');

  try {
    // Connect to VGGT space
    console.log('Connecting to facebook/vggt...');
    const client = await Client.connect('facebook/vggt');
    console.log('✓ Connected\n');

    // Get API info
    console.log('Fetching API information...');
    const apiInfo = await client.view_api();
    console.log('✓ API info retrieved\n');

    // Print full API info
    console.log('═══════════════════════════════════════════════════════');
    console.log('FULL API INFO:');
    console.log('═══════════════════════════════════════════════════════');
    console.log(JSON.stringify(apiInfo, null, 2));
    console.log('\n');

    // Extract endpoints
    console.log('═══════════════════════════════════════════════════════');
    console.log('AVAILABLE ENDPOINTS:');
    console.log('═══════════════════════════════════════════════════════');

    if (apiInfo.named_endpoints) {
      if (Array.isArray(apiInfo.named_endpoints)) {
        apiInfo.named_endpoints.forEach((endpoint: any, index: number) => {
          console.log(`\n[${index}] Endpoint:`, endpoint.name || endpoint);
          if (endpoint.parameters) {
            console.log('  Parameters:', endpoint.parameters);
          }
          if (endpoint.returns) {
            console.log('  Returns:', endpoint.returns);
          }
        });
      } else if (typeof apiInfo.named_endpoints === 'object') {
        Object.entries(apiInfo.named_endpoints).forEach(([name, endpoint]: [string, any], index) => {
          console.log(`\n[${index}] Endpoint: ${name}`);
          console.log('  Config:', endpoint);
        });
      }
    }

    console.log('\n');

    // Check for specific endpoint patterns
    console.log('═══════════════════════════════════════════════════════');
    console.log('SEARCHING FOR PREDICT ENDPOINT:');
    console.log('═══════════════════════════════════════════════════════');

    const possibleEndpoints = ['/predict', '/submit', '/run', 'predict', 'submit', 'run'];

    for (const endpoint of possibleEndpoints) {
      try {
        console.log(`\nTrying endpoint: "${endpoint}"`);
        // Don't actually call it, just check if it exists
        const endpointInfo = apiInfo.named_endpoints?.[endpoint];
        if (endpointInfo) {
          console.log(`  ✓ Found endpoint: ${endpoint}`);
          console.log(`  Info:`, endpointInfo);
        } else {
          console.log(`  ✗ Not found`);
        }
      } catch (error) {
        console.log(`  ✗ Error: ${error}`);
      }
    }

    // Check for numeric endpoints
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('CHECKING NUMERIC ENDPOINTS:');
    console.log('═══════════════════════════════════════════════════════');

    if (apiInfo.endpoints) {
      apiInfo.endpoints.forEach((endpoint: any, index: number) => {
        console.log(`\nEndpoint [${index}]:`, JSON.stringify(endpoint, null, 2));
      });
    }

    console.log('\n═══════════════════════════════════════════════════════');
    console.log('RECOMMENDATION:');
    console.log('═══════════════════════════════════════════════════════');
    console.log('\nBased on the API info above, the correct endpoint should be:');
    console.log('- Look for an endpoint that accepts image inputs');
    console.log('- Check the parameter order and types');
    console.log('- Use either the endpoint name (string) or index (number)');
    console.log('\nCommon patterns:');
    console.log('  client.predict(0, [...params])          // Using index');
    console.log('  client.predict("/predict", [...params]) // Using name');
    console.log('  client.predict("/predict", {...obj})    // Using object');

  } catch (error) {
    console.error('✗ Error:', error);
    if (error instanceof Error) {
      console.error('  Message:', error.message);
      console.error('  Stack:', error.stack);
    }
  }
}

main().catch(console.error);
