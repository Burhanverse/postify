export NVM_DIR="$HOME/.nvm"

mkdir -p "$NVM_DIR"

curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash

if ! grep -q "## nvm initialization" "$HOME/.bashrc" 2>/dev/null; then
	cat >> "$HOME/.bashrc" <<'BASHRC'
## nvm initialization
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && . "$NVM_DIR/bash_completion"
BASHRC
	printf "Appended nvm init to ~/.bashrc\n"
fi

[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

. ~/.bashrc 

nvm install 22.12.0
nvm alias default 22.12.0

node -v
npm -v

cd "$(dirname "$0")" || true
if [ -f "./package.json" ]; then
	npm i
else
	printf "No package.json found in %s, skipping npm i\n" "$(pwd)"
fi