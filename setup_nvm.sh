# install nvm (in case of no root access)
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash

export NVM_DIR=".nvm"

if ! grep -q "## nvm initialization" ".bashrc" 2>/dev/null; then
	cat >> ".bashrc" <<'BASHRC'
## nvm initialization
export NVM_DIR=".nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && . "$NVM_DIR/bash_completion"
BASHRC
	printf "Appended nvm init to ~/.bashrc\n"
fi

[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

nvm install 22.12.0
nvm alias default 22.12.0

node -v
npm -v
npm i