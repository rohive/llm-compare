#!/usr/bin/env bash
set -e
rm -rf server/public
mkdir -p server/public
cp -R frontend/dist/* server/public/
echo "Copied frontend/dist -> server/public"
