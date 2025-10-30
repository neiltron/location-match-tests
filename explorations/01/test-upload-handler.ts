/**
 * Test Script: Test the upload handler endpoint
 */

import { Client, FileData } from '@gradio/client';
import { readFile, readdir } from 'fs/promises';
import { join, basename } from 'path';

const TEST_IMAGES_DIR = './storage/test_images';

async function main() {
  console.log('Testing VGGT upload handler...\n');

  try {
    // Connect
    console.log('1. Connecting...');
    const client = await Client.connect('facebook/vggt');
    console.log('   ✓ Connected\n');

    // Get API info for upload endpoints
    console.log('2. Checking upload endpoints...');
    const apiInfo = await client.view_api();

    const uploadEndpoint = apiInfo.named_endpoints['/update_gallery_on_upload'];
    if (uploadEndpoint) {
      console.log('   /update_gallery_on_upload parameters:');
      if (uploadEndpoint.parameters) {
        uploadEndpoint.parameters.forEach((param: any) => {
          console.log(`   - ${param.parameter_name}: ${param.type} (${param.component})`);
        });
      }
      console.log('   Returns:');
      if (uploadEndpoint.returns) {
        uploadEndpoint.returns.forEach((ret: any) => {
          console.log(`   - ${ret.label || ret.component}: ${ret.type || ret.component}`);
        });
      }
    }
    console.log('');

    // Prepare test images
    console.log('3. Preparing test images...');
    const files = await readdir(TEST_IMAGES_DIR);
    const imageFiles = files.filter(f => /\.(jpg|jpeg|png)$/i.test(f)).sort();
    const testImages = imageFiles.slice(0, 3);
    console.log(`   Using ${testImages.length} images\n`);

    // Upload files
    console.log('4. Uploading files...');
    const rootUrl = client.config?.root;
    if (!rootUrl) {
      throw new Error('No root URL');
    }

    const fileDataList: FileData[] = [];
    for (const filename of testImages) {
      const filepath = join(TEST_IMAGES_DIR, filename);
      const buffer = await readFile(filepath);
      const file = new File([buffer], filename, { type: 'image/jpeg' });

      const uploadResponse = await client.upload_files(rootUrl, [file]);
      if (!uploadResponse.files || uploadResponse.files.length === 0) {
        throw new Error(`Upload failed for ${filename}`);
      }

      const fileData = new FileData({
        path: uploadResponse.files[0],
        orig_name: filename,
        size: file.size,
        mime_type: 'image/jpeg',
      });

      fileDataList.push(fileData);
      console.log(`   ✓ ${filename}`);
    }
    console.log('');

    // Try calling upload handler
    console.log('5. Calling /update_gallery_on_upload...');

    try {
      // Try with file list
      const result = await client.predict('/update_gallery_on_upload', [
        null,  // video input
        fileDataList,  // image files
      ]);

      console.log('   ✓ Success!');
      console.log('   Result:', JSON.stringify(result, null, 2));
      console.log('');

      // Check if we got a target directory
      if (result.data && Array.isArray(result.data)) {
        console.log('6. Result analysis:');
        result.data.forEach((item: any, index: number) => {
          console.log(`   [${index}]:`, typeof item, item);
        });
      }
    } catch (error: any) {
      console.log('   ✗ Failed:', error.message);
      console.log('');

      // Try alternative: calling with object parameters
      console.log('6. Trying with object parameters...');
      try {
        const result2 = await client.predict('/update_gallery_on_upload', {
          input_video: null,
          input_images: fileDataList,
        });
        console.log('   ✓ Success!');
        console.log('   Result:', JSON.stringify(result2, null, 2));
      } catch (error2: any) {
        console.log('   ✗ Also failed:', error2.message);
      }
    }

  } catch (error) {
    console.error('✗ Error:', error);
  }
}

main().catch(console.error);
