/**
 * Test Script: Verify correct VGGT workflow
 */

import { Client, FileData } from '@gradio/client';
import { readFile, readdir } from 'fs/promises';
import { join, basename } from 'path';

const TEST_IMAGES_DIR = './storage/test_images';

async function main() {
  console.log('Testing VGGT workflow...\n');

  try {
    // Step 1: Connect
    console.log('1. Connecting to facebook/vggt...');
    const client = await Client.connect('facebook/vggt');
    console.log('   ✓ Connected\n');

    // Step 2: Read test images
    console.log('2. Reading test images...');
    const files = await readdir(TEST_IMAGES_DIR);
    const imageFiles = files.filter(f => /\.(jpg|jpeg|png)$/i.test(f)).sort();
    console.log(`   ✓ Found ${imageFiles.length} images\n`);

    // Step 3: Upload images and get file handles
    console.log('3. Uploading images...');
    const rootUrl = client.config?.root;
    if (!rootUrl) {
      throw new Error('Client config root URL not available');
    }

    const fileHandles: any[] = [];
    for (const filename of imageFiles.slice(0, 3)) { // Test with first 3 images
      const filepath = join(TEST_IMAGES_DIR, filename);
      const buffer = await readFile(filepath);
      const file = new File([buffer], filename, { type: 'image/jpeg' });

      console.log(`   Uploading: ${filename} (${file.size} bytes)`);

      const uploadResponse = await client.upload_files(rootUrl, [file]);

      if (!uploadResponse.files || uploadResponse.files.length === 0) {
        throw new Error(`Upload failed for ${filename}`);
      }

      // Store the server path
      fileHandles.push({
        path: uploadResponse.files[0],
        orig_name: filename,
        size: file.size,
      });

      console.log(`     → ${uploadResponse.files[0]}`);
    }
    console.log(`   ✓ Uploaded ${fileHandles.length} files\n`);

    // Step 4: Check what endpoints are available
    console.log('4. Available endpoints:');
    const apiInfo = await client.view_api();
    const endpoints = Object.keys(apiInfo.named_endpoints || {});
    endpoints.forEach(ep => console.log(`   - ${ep}`));
    console.log('');

    // Step 5: Try to understand the correct workflow
    console.log('5. Analysis:');
    console.log('   The VGGT space appears to require a two-step process:');
    console.log('   a) Upload files (which we did successfully)');
    console.log('   b) The files need to be in a target directory on the server');
    console.log('   c) Call /gradio_demo with target_dir parameter');
    console.log('');
    console.log('   PROBLEM: We uploaded individual files, but /gradio_demo expects');
    console.log('   a directory path that already exists on the server.');
    console.log('');
    console.log('   The space likely has a hidden upload handler that:');
    console.log('   - Accepts file uploads');
    console.log('   - Creates a timestamped directory');
    console.log('   - Saves files there');
    console.log('   - Returns the directory path');
    console.log('   - Then passes that path to /gradio_demo');
    console.log('');

    // Step 6: Look at /gradio_demo parameters
    console.log('6. /gradio_demo parameters:');
    const gradioDemo = apiInfo.named_endpoints['/gradio_demo'];
    if (gradioDemo && gradioDemo.parameters) {
      gradioDemo.parameters.forEach((param: any) => {
        console.log(`   - ${param.parameter_name}: ${param.type} (${param.component})`);
        if (param.parameter_default !== undefined) {
          console.log(`     Default: ${param.parameter_default}`);
        }
      });
    }
    console.log('');

    // Step 7: Explanation
    console.log('7. SOLUTION:');
    console.log('   The Gradio client API may handle this differently than we expect.');
    console.log('   Looking at the demo_gradio.py code, there should be an upload');
    console.log('   component that handles files and returns a target_dir.');
    console.log('');
    console.log('   We need to find the upload endpoint or component that accepts');
    console.log('   the file list and returns the target directory path.');
    console.log('');

    // Step 8: Check for upload-related endpoints
    console.log('8. Looking for upload endpoints...');
    const uploadEndpoints = endpoints.filter(ep =>
      ep.includes('upload') || ep.includes('handle') || ep.includes('file')
    );
    if (uploadEndpoints.length > 0) {
      console.log('   Found potential upload endpoints:');
      uploadEndpoints.forEach(ep => console.log(`   - ${ep}`));
    } else {
      console.log('   No obvious upload endpoints found.');
      console.log('   The upload might be handled by a Gradio component event.');
    }
    console.log('');

    // Step 9: Try calling /gradio_demo with uploaded file paths
    console.log('9. ATTEMPTING: Call /gradio_demo with file parameters...');
    console.log('   This will likely fail, but lets see the error message.\n');

    try {
      // The /gradio_demo endpoint expects a target_dir (string)
      // Let's try passing the directory path from one of our uploaded files
      const firstFilePath = fileHandles[0].path;
      // Extract directory from path (remove filename)
      const targetDir = firstFilePath.split('/').slice(0, -1).join('/');

      console.log(`   Target dir: ${targetDir}`);
      console.log('   Calling /gradio_demo...');

      const result = await client.predict('/gradio_demo', {
        target_dir: targetDir,
        conf_thres: 50,
        frame_filter: 'All',
        mask_black_bg: false,
        mask_white_bg: false,
        show_cam: true,
        mask_sky: false,
        prediction_mode: 'Pointmap Branch',
      });

      console.log('   ✓ Success! Result:', result);
    } catch (error: any) {
      console.log('   ✗ Failed (expected):', error.message);
    }
    console.log('');

    console.log('═══════════════════════════════════════════════════════');
    console.log('CONCLUSION:');
    console.log('═══════════════════════════════════════════════════════');
    console.log('The VGGT Gradio space uses a specific workflow:');
    console.log('');
    console.log('1. The UI has file upload components (video/images)');
    console.log('2. When files are uploaded, a handler (handle_uploads) runs');
    console.log('3. This handler creates a timestamped directory and saves files');
    console.log('4. The directory path is then passed to gradio_demo()');
    console.log('');
    console.log('For API access, we need to either:');
    console.log('A) Find the upload handler endpoint to get the target_dir');
    console.log('B) Use the Gradio client\'s component interface differently');
    console.log('C) Check if there\'s a combined endpoint that handles both');
    console.log('');

  } catch (error) {
    console.error('✗ Error:', error);
  }
}

main().catch(console.error);
