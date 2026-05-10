/**
 * Production Deployment Diagnostic Script
 * 
 * Probes the Railway backend to verify what's actually running.
 * Run: node test-deploy.js
 */

const API = 'https://spedi-core-production.up.railway.app';

async function probe(label, url, check) {
    try {
        const res = await fetch(url);
        const status = res.status;
        let body;
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('json')) {
            body = await res.json();
        } else {
            body = await res.text();
        }
        const result = check ? check(status, body) : `${status}`;
        console.log(`✅ ${label}: ${result}`);
        return { ok: true, status, body };
    } catch (err) {
        console.log(`❌ ${label}: ${err.message}`);
        return { ok: false };
    }
}

async function main() {
    console.log(`\n🔍 Probing production API: ${API}\n${'─'.repeat(60)}\n`);

    // 1. Health check
    await probe('Health', `${API}/health`, (s, b) => `${s} — ${JSON.stringify(b)}`);

    // 2. OpenAPI spec — check version and paths
    const spec = await probe('OpenAPI Spec', `${API}/openapi.json`, (s, b) => {
        if (s !== 200) return `FAIL (status ${s})`;
        const version = b?.info?.version || 'UNKNOWN';
        const pathCount = b?.paths ? Object.keys(b.paths).length : 0;
        return `version=${version}, ${pathCount} paths`;
    });

    if (spec.ok && spec.body?.paths) {
        const paths = Object.keys(spec.body.paths);
        
        // Check for OPTIONS routes
        const optionsPaths = [];
        for (const p of paths) {
            if (spec.body.paths[p].options) {
                optionsPaths.push(p);
            }
        }
        console.log(`   OPTIONS routes remaining: ${optionsPaths.length > 0 ? optionsPaths.join(', ') : 'NONE (clean)'}`);

        // Check for trailing-slash duplicates
        const trailingSlash = paths.filter(p => p.endsWith('/') && p.length > 1);
        console.log(`   Trailing-slash paths: ${trailingSlash.length > 0 ? trailingSlash.join(', ') : 'NONE (clean)'}`);

        // Check for empty path objects
        const emptyPaths = paths.filter(p => {
            const methods = Object.keys(spec.body.paths[p]);
            return methods.length === 0;
        });
        console.log(`   Empty path objects: ${emptyPaths.length > 0 ? emptyPaths.join(', ') : 'NONE (clean)'}`);

        // Check servers block
        const servers = spec.body.servers || [];
        console.log(`   Servers block: ${servers.length === 0 ? 'empty (correct)' : JSON.stringify(servers)}`);
        
        // List all paths by tag
        console.log(`\n   All paths:`);
        for (const p of paths.sort()) {
            const methods = Object.keys(spec.body.paths[p]).join(', ').toUpperCase();
            console.log(`     ${methods.padEnd(20)} ${p}`);
        }
    }

    // 3. Check if /config/system exists (should be 401 or 403 without auth)
    await probe('/config/system route', `${API}/config/system`, (s) => {
        if (s === 404) return 'NOT FOUND — old server code (route does not exist)';
        if (s === 401) return 'EXISTS — returns 401 (auth required, expected)';
        return `Status ${s} — route exists`;
    });

    // 4. Check /config (should be 401 without auth)
    await probe('/config route', `${API}/config`, (s) => {
        if (s === 401) return 'EXISTS — returns 401 (auth required, expected)';
        return `Status ${s}`;
    });

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`\n💡 If version shows 1.0.5, the OLD code is deployed.`);
    console.log(`   If version shows 1.0.6, the NEW code is deployed.\n`);
}

main().catch(console.error);
