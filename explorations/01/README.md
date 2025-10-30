# VGGT Explorer - Exploration 01

Interactive UI for running VGGT (Video Geometry Ground Truth) reconstructions on image sets.

## Features
- Drag & drop image upload
- Adjustable VGGT settings
- HuggingFace Gradio API integration
- Three.js 3D viewer with camera transforms
- Hover-to-animate camera transitions
- Local result storage

## Setup

```bash
cd explorations/01
bun install
```

## Environment Variables

Create a `.env` file in this directory with:

```
HF_TOKEN=your_huggingface_token
```

Get your token from: https://huggingface.co/settings/tokens

The VGGT space (neiltron/vggt) is private and requires authentication.

## Running

```bash
bun dev
```

Open http://localhost:3000

## Architecture
- Backend: Bun + Elysia
- Frontend: Vanilla TypeScript + Three.js
- Storage: Local filesystem
