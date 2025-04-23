import dotenv from 'dotenv';
import path from 'path';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import fs from 'fs';
import { isHttpUrl } from './utils/httpClient';

dotenv.config();

// Parse custom headers from environment variables
const customHeadersFromEnv: Record<string, string> = {};
Object.keys(process.env).forEach(key => {
    if (key.startsWith('HEADER_')) {
        const headerName = key.substring(7); // Remove 'HEADER_' prefix
        customHeadersFromEnv[headerName] = process.env[key] || '';
    }
});

// Function to load JSON configuration file
function loadJsonConfig(configPath: string): Record<string, any> {
    try {
        if (fs.existsSync(configPath)) {
            const configContent = fs.readFileSync(configPath, 'utf8');
            const jsonConfig = JSON.parse(configContent);
            console.error(`Loaded configuration from ${configPath}`);
            return jsonConfig;
        }
    } catch (error) {
        console.error(`Error loading JSON config from ${configPath}:`, error);
    }
    return {};
}

// Get the package directory when running via npx
function getPackageDirectory(): string | null {
    try {
        // When running via npx, __dirname will point to the package's bin directory
        // We need to go up to the package root (from dist/src/ to package root)
        const mainModulePath = require.main?.filename || '';
        
        // For a typical package structure, we need to go up several levels
        // From <package>/dist/src/server.js to <package>
        let packageDir = path.dirname(mainModulePath);
        
        // Go up to package root (typically 2 levels)
        if (packageDir.includes('dist/src')) {
            packageDir = path.resolve(packageDir, '../..');
        } else if (packageDir.includes('dist')) {
            packageDir = path.resolve(packageDir, '..');
        }
        
        // Verify this looks like a package directory by checking for package.json
        if (fs.existsSync(path.join(packageDir, 'package.json'))) {
            return packageDir;
        }
    } catch (error) {
        console.error('Error determining package directory:', error);
    }
    return null;
}

// Get config paths to check
function getConfigPaths(): string[] {
    // Check if running as a package (via npx)
    const packageDir = getPackageDirectory();
    if (packageDir) {
        const packageConfigPath = path.join(packageDir, 'config.json');
        console.error(`Checking for package config at: ${packageConfigPath}`);
        return [packageConfigPath];
    } else {
        // Fallback to current working directory if not running as a package
        return [
            path.resolve(process.cwd(), 'config.json'),
            path.resolve(process.cwd(), 'openapi-mcp.json'),
            path.resolve(process.cwd(), '.openapi-mcp.json')
        ];
    }
}

// Load configuration
let jsonConfig: Record<string, any> = {};
if (process.env.CONFIG_FILE) {
    // If CONFIG_FILE env var is set, try to load from that path
    jsonConfig = loadJsonConfig(process.env.CONFIG_FILE);
} else {
    // Otherwise, try paths based on execution context
    const configPaths = getConfigPaths();
    for (const configPath of configPaths) {
        const config = loadJsonConfig(configPath);
        if (Object.keys(config).length > 0) {
            jsonConfig = config;
            break;
        }
    }
}

const argv = yargs(hideBin(process.argv))
    .option('config', {
        alias: 'c',
        type: 'string',
        description: 'Path to JSON configuration file',
        default: process.env.CONFIG_FILE,
    })
    .option('spec', {
        alias: 's',
        type: 'string',
        description: 'Path to the OpenAPI specification file',
        default: jsonConfig.spec || process.env.OPENAPI_SPEC_PATH,
    })
    .option('overlays', {
        alias: 'o',
        type: 'string', // Comma-separated paths
        description: 'Comma-separated paths to OpenAPI overlay files',
        default: jsonConfig.overlays || process.env.OPENAPI_OVERLAY_PATHS,
    })
    .option('port', {
        alias: 'p',
        type: 'number',
        description: 'Port for the MCP server',
        default: jsonConfig.port || parseInt(process.env.MCP_SERVER_PORT || '8080', 10),
    })
    .option('targetUrl', {
        alias: 'u',
        type: 'string',
        description: 'Target API base URL (overrides OpenAPI servers)',
        default: jsonConfig.targetUrl || process.env.TARGET_API_BASE_URL,
    })
    .option('whitelist', {
        alias: 'w',
        type: 'string',
        description: 'Comma-separated operationIds or URL paths to include (supports glob patterns)',
        default: jsonConfig.whitelist || process.env.MCP_WHITELIST_OPERATIONS,
    })
    .option('blacklist', {
        alias: 'b',
        type: 'string',
        description: 'Comma-separated operationIds or URL paths to exclude (supports glob patterns, ignored if whitelist used)',
        default: jsonConfig.blacklist || process.env.MCP_BLACKLIST_OPERATIONS,
    })
    // Add options for credentials as needed
    .option('apiKey', {
        type: 'string',
        description: 'API Key for the target API',
        default: jsonConfig.apiKey || process.env.API_KEY,
    })
    .option('securitySchemeName', {
        type: 'string',
        description: 'Name of the security scheme requiring the API Key',
        default: jsonConfig.securitySchemeName || process.env.SECURITY_SCHEME_NAME
    })
    .option('securityCredentials', {
        type: 'string',
        description: 'JSON string containing security credentials for multiple schemes',
        default: jsonConfig.securityCredentials ? 
            (typeof jsonConfig.securityCredentials === 'string' ? 
                jsonConfig.securityCredentials : 
                JSON.stringify(jsonConfig.securityCredentials)) : 
            process.env.SECURITY_CREDENTIALS,
    })
    .option('headers', {
        type: 'string',
        description: 'JSON string containing custom headers to include in all API requests',
        default: jsonConfig.headers ? 
            (typeof jsonConfig.headers === 'string' ? 
                jsonConfig.headers : 
                JSON.stringify(jsonConfig.headers)) : 
            process.env.CUSTOM_HEADERS,
    })
    .option('disableXMcp', {
        type: 'boolean',
        description: 'Disable adding X-MCP: 1 header to all API requests',
        default: jsonConfig.disableXMcp !== undefined ? 
            jsonConfig.disableXMcp : 
            process.env.DISABLE_X_MCP === 'true',
    })
    .help()
    .parseSync(); // Use parseSync or handle async parsing

if (!argv.spec) {
    console.error("Error: OpenAPI specification path is required. Set OPENAPI_SPEC_PATH environment variable, use --spec option, or specify in config file.");
    process.exit(1);
}

// Parse security credentials if present
let securityCredentials: Record<string, string> = {};
if (argv.securityCredentials) {
    try {
        securityCredentials = JSON.parse(argv.securityCredentials);
    } catch (e) {
        console.error('Failed to parse security credentials JSON, using empty object instead:', e);
    }
}

// Parse custom headers if present
let customHeaders: Record<string, string> = { ...customHeadersFromEnv };
if (argv.headers) {
    try {
        const headersFromArg = JSON.parse(argv.headers);
        customHeaders = { ...customHeaders, ...headersFromArg };
    } catch (e) {
        console.error('Failed to parse custom headers JSON, using headers from env vars only:', e);
    }
}

export const config = {
    specPath: isHttpUrl(argv.spec) ? argv.spec : path.resolve(argv.spec),
    overlayPaths: argv.overlays
        ? argv.overlays.split(',').map((p: string) => isHttpUrl(p.trim()) ? p.trim() : path.resolve(p.trim()))
        : [],
    mcpPort: argv.port,
    targetApiBaseUrl: argv.targetUrl, // Explicit config takes precedence
    apiKey: argv.apiKey,
    securitySchemeName: argv.securitySchemeName,
    securityCredentials, // The parsed security credentials for multiple schemes
    customHeaders, // Custom headers for all API requests
    disableXMcp: argv.disableXMcp || false, // Flag to disable X-MCP header
    filter: {
        whitelist: argv.whitelist ? argv.whitelist.split(',').map((pattern: string) => pattern.trim()) : null,
        blacklist: argv.blacklist ? argv.blacklist.split(',').map((pattern: string) => pattern.trim()) : [],
    },
};

console.error('Configuration loaded:');
console.error(`- OpenAPI Spec: ${config.specPath}`);
if (config.overlayPaths.length > 0) {
    console.error(`- Overlays: ${config.overlayPaths.join(', ')}`);
}
console.error(`- MCP Server Port: ${config.mcpPort}`);
if (config.targetApiBaseUrl) {
    console.error(`- Target API Base URL: ${config.targetApiBaseUrl}`);
} else {
    console.error(`- Target API Base URL: Will use 'servers' from OpenAPI spec.`);
}
if (config.filter.whitelist) {
    console.error(`- Whitelist Patterns: ${config.filter.whitelist.join(', ')} (supports glob patterns for operationId and URL paths)`);
} else if (config.filter.blacklist.length > 0) {
    console.error(`- Blacklist Patterns: ${config.filter.blacklist.join(', ')} (supports glob patterns for operationId and URL paths)`);
}
if (Object.keys(config.securityCredentials).length > 0) {
    console.error(`- Security Credentials: ${Object.keys(config.securityCredentials).join(', ')}`);
}
if (config.apiKey) {
    console.error('- API Key: [REDACTED]');
}
if (Object.keys(config.customHeaders).length > 0) {
    console.error(`- Custom Headers: ${Object.keys(config.customHeaders).join(', ')}`);
}
console.error(`- X-MCP Header: ${config.disableXMcp ? 'Disabled' : 'Enabled'}`);