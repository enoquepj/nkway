# Como publicar o NKWAY no GitHub

## ⚠️ Quem faz o quê

| Etapa | Quem executa | O token aparece? |
|---|---|---|
| Criar repositório no GitHub | **Você**, no navegador | não |
| Gerar o token | **Você**, no navegador | sim — só na sua tela |
| Guardar o token | **Você**, no bloco de notas | fica só com você |
| Rodar `./publicar.sh` | **Você**, no comando prompt do seu PC | você cola na hora |
| Assistente (eu) | preparei o código e o script | **nunca vejo o token** |

**O token nunca passa por mim.** Ele vai direto do seu navegador para o
comando prompt, e do comando prompt para o GitHub. Não cole o token no chat.


## Etapa 1 — Criar o repositório vazio

1. Acesse **https://github.com/new**
2. Em **Repository name**, digite: `nkway`
3. Marque a opção **Private** (privado) ⚠️
   *A senha do console está no código — não deixe público.*
4. **NÃO** marque nenhuma das caixas de "Initialize this repository"
   (sem README, sem .gitignore, sem license)
5. Clique em **Create repository**

---

## Etapa 2 — Gerar o token de acesso

O GitHub não aceita mais a senha da conta pelo comando prompt. É preciso um
**token**, que funciona como uma senha temporária.

### Caminho direto (mais fácil)

Abra este link já logado no GitHub:

**https://github.com/settings/tokens/new**

Se pedir confirmação de senha, digite a senha da sua conta.

### Caminho pelos menus (se o link não abrir)

1. Clique na **sua foto de perfil**, no canto superior direito
2. Clique em **Settings** (Configurações)
3. Role a página até o **fim do menu lateral esquerdo**
4. Clique em **Developer settings** (Configurações de desenvolvedor)
5. Clique em **Personal access tokens**
6. Clique em **Tokens (classic)**
7. Botão **Generate new token** → escolha **Generate new token (classic)**

> ⚠️ Existem dois tipos: *Fine-grained* e *Classic*.
> Use o **Classic** — é mais simples e funciona direto.

### Preenchendo o formulário — campo por campo

A tela chama **"New personal access token (classic)"**.
Ela tem 3 partes, de cima para baixo:

#### 1️⃣ Note
Caixa de texto logo no topo, abaixo da palavra **Note**.

➡️ **Digite:** `nkway`

*(É só um apelido para você lembrar para que serve. Pode ser qualquer nome.)*

#### 2️⃣ Expiration
Uma **lista suspensa** (dropdown) que vem marcada como `30 days`.

➡️ **Clique nela e escolha:** `90 days`

*(Se escolher "No expiration", o GitHub mostra um aviso amarelo. Pode ignorar — mas 90 dias é mais seguro.)*

#### 3️⃣ Select scopes
A maior parte da tela. É uma **lista grande de caixas de seleção**
com nomes como `repo`, `workflow`, `write:packages`, `admin:org`...

➡️ **Marque APENAS a primeira caixa, chamada `repo`**

Ela aparece assim:

```
☑ repo          Full control of private repositories
   ☑ repo:status
   ☑ repo_deployment
   ☑ public_repo
   ☑ repo:invite
   ☑ security_events
```

Ao clicar em `repo`, as 5 linhas de baixo **marcam sozinhas**.
Isso é o correto — não desmarque nenhuma.

**Não marque mais nada** nas outras seções da lista.

#### 4️⃣ Gerar

Role a página até o **final** e clique no botão verde:

➡️ **Generate token**

### Copiar o token

### Copiar o token

O GitHub mostra um código parecido com:

```
ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8
```

**Copie agora** — ele aparece uma única vez. Se perder, gere outro.

---

## Etapa 3 — Enviar o projeto

No comando prompt (Prompt de Comando do Windows), dentro da pasta do projeto:

```bash
./publicar.sh SEU_USUARIO_GITHUB
```

Quando aparecer:

- **Username:** digite seu usuário do GitHub
- **Password:** cole o **token** (não a senha da conta)

> O comando prompt não mostra nada enquanto você cola a senha.
> Isso é normal — cole e aperte Enter.

**Pronto.** Seu repositório estará em:
`https://github.com/SEU_USUARIO/nkway`

---

## Alternativa sem token — GitHub Desktop

Se preferir não mexer com token:

1. Baixe o **GitHub Desktop**: https://desktop.github.com
2. Instale e faça login com sua conta (pelo navegador, sem token)
3. Menu **File → Add local repository**
4. Selecione a pasta deste projeto
5. Clique em **Publish repository**
6. Marque **Keep this code private** e confirme

O programa cuida de tudo sozinho.

---

## Alternativa sem GitHub — só o site no ar

Se você só quer o **link do sistema funcionando**:

```bash
npm run build
```

Depois arraste a pasta **`dist`** em:
**https://app.netlify.com/drop**

O link sai na hora, sem conta e sem token.

---

## Etapa 4 — Colocar o site no ar pelo GitHub

Com o repositório publicado:

1. Acesse **https://vercel.com/new**
2. Entre com **Continue with GitHub**
3. Localize o repositório `nkway` e clique em **Import**
4. Não mude nada (o `vercel.json` já está configurado)
5. Clique em **Deploy**

Em cerca de 1 minuto o link estará pronto:
`https://nkway.vercel.app`
