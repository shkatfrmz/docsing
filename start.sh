#!/bin/bash
cd /workspace/backend && node server.js &
cd /workspace/frontend && npm run dev
