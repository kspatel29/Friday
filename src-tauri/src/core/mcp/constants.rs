use std::time::Duration;

// MCP Constants
pub const MCP_TOOL_CALL_TIMEOUT: Duration = Duration::from_secs(30);
pub const MCP_BASE_RESTART_DELAY_MS: u64 = 1000; // Start with 1 second
pub const MCP_MAX_RESTART_DELAY_MS: u64 = 90000; // Cap at 60 seconds
pub const MCP_BACKOFF_MULTIPLIER: f64 = 2.0; // Double the delay each time

pub const DEFAULT_MCP_CONFIG: &str = r#"{
  "mcpServers": {
    "fetch": {
      "command": "uvx",
      "args": ["mcp-server-fetch"],
      "env": {},
      "active": true
    },
    "agentic-tools": {
      "command": "npx",
      "args": ["-y", "@pimzino/agentic-tools-mcp", "--claude"],
      "env" : {},
      "active": true
    },
    "blender-mcp": {
      "command": "uvx",
      "args": ["blender-mcp"],
      "env": {},
      "active": true
    },
    "unreal-mcp": {
      "command": "uvx",
      "args": ["--from", "gamewave-unreal-mcp", "unreal-mcp"],
      "env": {},
      "active": true
    }
  }
}"#;
