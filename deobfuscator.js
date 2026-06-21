const express = require('express');
const fengari = require('fengari');

const { lua, lauxlib, lualib } = fengari;

const app = express();

// Middleware
app.use(express.json({ limit: '5mb' }));
app.use(express.text({ type: 'text/plain', limit: '5mb' }));

/**
 * Jalankan script Lua menggunakan fengari dan tangkap return value-nya.
 * Script dibungkus agar nilai balik (return) tertangkap sebagai string.
 */
function executeLua(script) {
    const L = lauxlib.luaL_newstate();
    lualib.luaL_openlibs(L);

    try {
        // Bungkus script agar mengembalikan hasil eksekusi sebagai string
        const wrapped = `
            local function _main()
                ${script}
            end
            local result = _main()
            if result == nil then
                return ""
            elseif type(result) == "string" then
                return result
            elseif type(result) == "function" then
                local ok, val = pcall(result)
                if ok then
                    return tostring(val)
                else
                    return "error: " .. tostring(val)
                end
            else
                return tostring(result)
            end
        `;

        const status = lauxlib.luaL_loadstring(L, wrapped);
        if (status !== 0) {
            const err = lauxlib.lua_tostring(L, -1);
            lauxlib.lua_pop(L, 1);
            throw new Error(`Load error: ${err}`);
        }

        const pcallResult = lauxlib.lua_pcall(L, 0, 1, 0);
        if (pcallResult !== 0) {
            const err = lauxlib.lua_tostring(L, -1);
            lauxlib.lua_pop(L, 1);
            throw new Error(`Runtime error: ${err}`);
        }

        const output = lauxlib.lua_tostring(L, -1);
        lauxlib.lua_pop(L, 1);
        return output || '';
    } finally {
        lauxlib.lua_close(L);
    }
}

// === API Routes ===

app.get('/api/deobfuscate', (req, res) => {
    res.json({
        status: 'ok',
        message: 'Kirim POST dengan body text/plain berisi script Lua yang di-obfuscate.',
    });
});

app.post('/api/deobfuscate', async (req, res) => {
    try {
        const script = req.body;
        if (!script || typeof script !== 'string' || script.trim().length === 0) {
            return res.status(400).json({ error: 'Body harus berupa string Lua yang valid.' });
        }

        // Batasi ukuran untuk keamanan
        if (script.length > 2_000_000) {
            return res.status(413).json({ error: 'Script terlalu besar (maks 2MB).' });
        }

        console.log(`[deobf] Menerima script (${script.length} chars)`);

        // Jalankan dengan timeout manual (pakai Promise race)
        const result = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timeout: eksekusi Lua melebihi 10 detik.'));
            }, 10000);

            try {
                const out = executeLua(script);
                clearTimeout(timeout);
                resolve(out);
            } catch (err) {
                clearTimeout(timeout);
                reject(err);
            }
        });

        res.json({ result });
    } catch (err) {
        console.error('[deobf] Error:', err.message);
        res.status(500).json({
            error: err.message || 'Terjadi kesalahan internal.',
        });
    }
});

// === Vercel serverless export ===
module.exports = app;

// === Local development server ===
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`🚀 WeAreDevs Deobfuscator API running on http://localhost:${PORT}`);
        console.log(`   POST /api/deobfuscate`);
    });
}