## GitHub Copilot Chat

- Extension: 0.42.3 (prod)
- VS Code: 1.114.0 (e7fb5e96c0730b9deb70b33781f98e2f35975036)
- OS: win32 10.0.18363 x64
- GitHub Account: watch2earn36

## Network

User Settings:
```json
  "http.systemCertificatesNode": true,
  "github.copilot.advanced.debug.useElectronFetcher": true,
  "github.copilot.advanced.debug.useNodeFetcher": false,
  "github.copilot.advanced.debug.useNodeFetchFetcher": true
```

Connecting to https://api.github.com:
- DNS ipv4 Lookup: 140.82.121.5 (967 ms)
- DNS ipv6 Lookup: Error (201 ms): getaddrinfo ENOTFOUND api.github.com
- Proxy URL: None (3 ms)
- Electron fetch (configured): Error (419 ms): Error: net::ERR_CERT_DATE_INVALID
	at SimpleURLLoaderWrapper.<anonymous> (node:electron/js2c/utility_init:2:10684)
	at SimpleURLLoaderWrapper.emit (node:events:519:28)
  {"is_request_error":true,"network_process_crashed":false}
- Node.js https: timed out after 10 seconds
- Node.js fetch: Error (1784 ms): TypeError: fetch failed
	at node:internal/deps/undici/undici:14902:13
	at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
	at async t._fetch (c:\Users\User\.vscode\extensions\github.copilot-chat-0.42.3\dist\extension.js:5171:5228)
	at async t.fetch (c:\Users\User\.vscode\extensions\github.copilot-chat-0.42.3\dist\extension.js:5171:4540)
	at async u (c:\Users\User\.vscode\extensions\github.copilot-chat-0.42.3\dist\extension.js:5203:186)
	at async yg._executeContributedCommand (file:///c:/Users/User/AppData/Local/Programs/Microsoft%20VS%20Code/e7fb5e96c0/resources/app/out/vs/workbench/api/node/extensionHostProcess.js:501:48675)
  Error: certificate is not yet valid
  	at TLSSocket.onConnectSecure (node:_tls_wrap:1697:34)
  	at TLSSocket.emit (node:events:519:28)
  	at TLSSocket._finishInit (node:_tls_wrap:1095:8)
  	at ssl.onhandshakedone (node:_tls_wrap:881:12)

Connecting to https://api.githubcopilot.com/_ping:
- DNS ipv4 Lookup: 140.82.113.21 (72 ms)
- DNS ipv6 Lookup: Error (84 ms): getaddrinfo ENOTFOUND api.githubcopilot.com
- Proxy URL: None (43 ms)
- Electron fetch (configured): Error (1918 ms): Error: net::ERR_CERT_DATE_INVALID
	at SimpleURLLoaderWrapper.<anonymous> (node:electron/js2c/utility_init:2:10684)
	at SimpleURLLoaderWrapper.emit (node:events:519:28)
  {"is_request_error":true,"network_process_crashed":false}
- Node.js https: Error (618 ms): Error: certificate is not yet valid
	at TLSSocket.onConnectSecure (node:_tls_wrap:1697:34)
	at TLSSocket.emit (node:events:519:28)
	at TLSSocket._finishInit (node:_tls_wrap:1095:8)
	at ssl.onhandshakedone (node:_tls_wrap:881:12)
- Node.js fetch: Error (838 ms): TypeError: fetch failed
	at node:internal/deps/undici/undici:14902:13
	at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
	at async t._fetch (c:\Users\User\.vscode\extensions\github.copilot-chat-0.42.3\dist\extension.js:5171:5228)
	at async t.fetch (c:\Users\User\.vscode\extensions\github.copilot-chat-0.42.3\dist\extension.js:5171:4540)
	at async u (c:\Users\User\.vscode\extensions\github.copilot-chat-0.42.3\dist\extension.js:5203:186)
	at async yg._executeContributedCommand (file:///c:/Users/User/AppData/Local/Programs/Microsoft%20VS%20Code/e7fb5e96c0/resources/app/out/vs/workbench/api/node/extensionHostProcess.js:501:48675)
  Error: certificate is not yet valid
  	at TLSSocket.onConnectSecure (node:_tls_wrap:1697:34)
  	at TLSSocket.emit (node:events:519:28)
  	at TLSSocket._finishInit (node:_tls_wrap:1095:8)
  	at ssl.onhandshakedone (node:_tls_wrap:881:12)

Connecting to https://copilot-proxy.githubusercontent.com/_ping:
- DNS ipv4 Lookup: 4.225.11.192 (1282 ms)
- DNS ipv6 Lookup: Error (85 ms): getaddrinfo ENOTFOUND copilot-proxy.githubusercontent.com
- Proxy URL: None (64 ms)
- Electron fetch (configured): Error (2105 ms): Error: net::ERR_CERT_DATE_INVALID
	at SimpleURLLoaderWrapper.<anonymous> (node:electron/js2c/utility_init:2:10684)
	at SimpleURLLoaderWrapper.emit (node:events:519:28)
  {"is_request_error":true,"network_process_crashed":false}
- Node.js https: Error (937 ms): Error: certificate is not yet valid
	at TLSSocket.onConnectSecure (node:_tls_wrap:1697:34)
	at TLSSocket.emit (node:events:519:28)
	at TLSSocket._finishInit (node:_tls_wrap:1095:8)
	at ssl.onhandshakedone (node:_tls_wrap:881:12)
- Node.js fetch: Error (2149 ms): TypeError: fetch failed
	at node:internal/deps/undici/undici:14902:13
	at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
	at async t._fetch (c:\Users\User\.vscode\extensions\github.copilot-chat-0.42.3\dist\extension.js:5171:5228)
	at async t.fetch (c:\Users\User\.vscode\extensions\github.copilot-chat-0.42.3\dist\extension.js:5171:4540)
	at async u (c:\Users\User\.vscode\extensions\github.copilot-chat-0.42.3\dist\extension.js:5203:186)
	at async yg._executeContributedCommand (file:///c:/Users/User/AppData/Local/Programs/Microsoft%20VS%20Code/e7fb5e96c0/resources/app/out/vs/workbench/api/node/extensionHostProcess.js:501:48675)
  Error: certificate is not yet valid
  	at TLSSocket.onConnectSecure (node:_tls_wrap:1697:34)
  	at TLSSocket.emit (node:events:519:28)
  	at TLSSocket._finishInit (node:_tls_wrap:1095:8)
  	at ssl.onhandshakedone (node:_tls_wrap:881:12)

Connecting to https://mobile.events.data.microsoft.com: Error (3042 ms): Error: net::ERR_CERT_DATE_INVALID
	at SimpleURLLoaderWrapper.<anonymous> (node:electron/js2c/utility_init:2:10684)
	at SimpleURLLoaderWrapper.emit (node:events:519:28)
  {"is_request_error":true,"network_process_crashed":false}
Connecting to https://dc.services.visualstudio.com: Error (2823 ms): Error: net::ERR_CERT_DATE_INVALID
	at SimpleURLLoaderWrapper.<anonymous> (node:electron/js2c/utility_init:2:10684)
	at SimpleURLLoaderWrapper.emit (node:events:519:28)
  {"is_request_error":true,"network_process_crashed":false}
Connecting to https://copilot-telemetry.githubusercontent.com/_ping: Error (3481 ms): Error: certificate is not yet valid
	at TLSSocket.onConnectSecure (node:_tls_wrap:1697:34)
	at TLSSocket.emit (node:events:519:28)
	at TLSSocket._finishInit (node:_tls_wrap:1095:8)
	at ssl.onhandshakedone (node:_tls_wrap:881:12)
Connecting to https://copilot-telemetry.githubusercontent.com/_ping: 