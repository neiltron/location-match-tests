/**
 * Test Script: Complete VGGT workflow
 * 1. Upload images via /update_gallery_on_upload
 * 2. Get target directory
 * 3. Call /gradio_demo with target directory
 */

import { Client, FileData } from '@gradio/client';
import { readFile, readdir } from 'fs/promises';
import { join, basename } from 'path';

const TEST_IMAGES_DIR = './storage/test_images';

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  VGGT Complete Workflow Test');
  console.log('═══════════════════════════════════════════════════════\n');

  try {
    // Step 1: Connect
    console.log('Step 1: Connecting to facebook/vggt...');
    const client = await Client.connect('facebook/vggt');
    console.log('        ✓ Connected\n');

    // Step 2: Prepare test images
    console.log('Step 2: Preparing test images...');
    const files = await readdir(TEST_IMAGES_DIR);
    const imageFiles = files.filter(f => /\.(jpg|jpeg|png)$/i.test(f)).sort();
    const testImages = imageFiles.slice(0, 3); // Use first 3 images
    console.log(`        Using ${testImages.length} images: ${testImages.join(', ')}\n`);

    // Step 3: Upload files
    console.log('Step 3: Uploading files to server...');
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
      console.log(`        ✓ ${filename} (${file.size} bytes)`);
    }
    console.log('');

    // Step 4: Call upload handler to organize files
    console.log('Step 4: Calling upload handler to organize files...');
    const uploadResult = await client.predict('/update_gallery_on_upload', [
      null,  // video input
      fileDataList,  // image files
    ]);

    console.log('        ✓ Upload handler completed');

    // Extract target directory from result
    if (!uploadResult.data || !Array.isArray(uploadResult.data) || uploadResult.data.length < 2) {
      throw new Error('Unexpected upload handler response format');
    }

    const targetDir = uploadResult.data[1];
    if (typeof targetDir !== 'string') {
      throw new Error('Target directory not found in response');
    }

    console.log(`        Target directory: ${targetDir}\n`);

    // Step 5: Submit to VGGT processing
    console.log('Step 5: Submitting to VGGT for 3D reconstruction...');
    console.log('        Parameters:');
    console.log('        - conf_thres: 45');
    console.log('        - prediction_mode: Pointmap Branch');
    console.log('        - mask_black_bg: false');
    console.log('        - mask_white_bg: false');
    console.log('        - mask_sky: false');
    console.log('        - show_cam: true\n');

    const reconstructResult = await client.predict('/gradio_demo', [
      targetDir,  // target_dir
      45,  // conf_thres
      'All',  // frame_filter
      false,  // mask_black_bg
      false,  // mask_white_bg
      true,  // show_cam
      false,  // mask_sky
      'Pointmap Branch',  // prediction_mode
    ]);

    console.log('        ✓ Reconstruction completed!\n');

    // Step 6: Analyze results
    console.log('Step 6: Analyzing results...');
    if (reconstructResult.data && Array.isArray(reconstructResult.data)) {
      console.log(`        Result contains ${reconstructResult.data.length} outputs:\n`);

      reconstructResult.data.forEach((item: any, index: number) => {
        console.log(`        [${index}] ${typeof item}`);
        if (item && typeof item === 'object') {
          if (item.path) {
            console.log(`            Path: ${item.path}`);
          }
          if (item.url) {
            console.log(`            URL: ${item.url}`);
          }
          if (item.orig_name) {
            console.log(`            Filename: ${item.orig_name}`);
          }
        } else if (typeof item === 'string' && item.length > 0) {
          const preview = item.length > 100 ? item.substring(0, 100) + '...' : item;
          console.log(`            Content: ${preview}`);
        }
        console.log('');
      });

      // Check for GLB file
      const glbFile = reconstructResult.data.find((item: any) =>
        item && typeof item === 'object' && item.path && item.path.endsWith('.glb')
      );

      if (glbFile) {
        console.log('        ✓ GLB file generated!');
        console.log(`          URL: ${glbFile.url}`);
        console.log(`          Path: ${glbFile.path}`);
      } else {
        console.log('        ⚠ No GLB file found in results');
      }
    }

    console.log('\n═══════════════════════════════════════════════════════');
    console.log('  SUCCESS! Workflow completed');
    console.log('═══════════════════════════════════════════════════════\n');

    console.log('Summary:');
    console.log(`  1. Uploaded ${fileDataList.length} images`);
    console.log(`  2. Created target directory: ${targetDir}`);
    console.log(`  3. Ran 3D reconstruction`);
    console.log('  4. Generated GLB output\n');

    console.log('Next steps for vggt-client.ts:');
    console.log('  1. Call /update_gallery_on_upload with uploaded files');
    console.log('  2. Extract target_dir from response.data[1]');
    console.log('  3. Call /gradio_demo with target_dir and parameters');
    console.log('  4. Download GLB from response.data[0]');

  } catch (error: any) {
    console.error('\n✗ Error:', error.message);
    if (error.stack) {
      console.error('\nStack trace:', error.stack);
    }
  }
}

main().catch(console.error);
