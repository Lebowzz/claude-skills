#!/usr/bin/env bash
set -eu
git clone -q "$(dirname "$0")/files/repo.bundle" repo
cd repo && git checkout -q feature/discounts
