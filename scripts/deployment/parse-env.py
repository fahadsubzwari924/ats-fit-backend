#!/usr/bin/env python3
"""
Environment Variables Parser for .env.prod
Extracts variables and categorizes them as secrets or regular env vars
"""

import re
import sys

def should_be_secret(key):
    """Determine if a variable should be stored as a secret"""
    sensitive_keywords = ['PASSWORD', 'SECRET', 'KEY', 'TOKEN', 'API_KEY']
    special_cases = ['DATABASE_USERNAME', 'REDIS_HOST']
    
    return any(kw in key for kw in sensitive_keywords) or key in special_cases

def parse_env_file(filepath):
    """Parse .env file and categorize variables"""
    env_vars = {}
    secret_vars = {}
    
    try:
        with open(filepath, 'r') as f:
            for line_num, line in enumerate(f, 1):
                # Skip empty lines and comments
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                
                # Match KEY=VALUE pattern
                match = re.match(r'^([A-Z_][A-Z0-9_]*)=(.*)$', line)
                if match:
                    key = match.group(1)
                    value = match.group(2)
                    
                    # Remove quotes
                    value = value.strip('\'"')
                    
                    # Remove inline comments
                    if '#' in value:
                        value = value.split('#')[0].strip()
                    
                    # Skip empty or placeholder values
                    if not value or value == f'${{{key}}}':
                        continue
                    
                    # Categorize
                    if should_be_secret(key):
                        secret_vars[key] = value
                    else:
                        env_vars[key] = value
        
        return env_vars, secret_vars
    
    except FileNotFoundError:
        print(f"ERROR: File not found: {filepath}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"ERROR: Failed to parse file: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    if len(sys.argv) != 2:
        print("Usage: python3 parse_env.py <env_file>", file=sys.stderr)
        sys.exit(1)
    
    filepath = sys.argv[1]
    env_vars, secret_vars = parse_env_file(filepath)
    
    # Output in bash-sourceable format
    print(f"# Parsed {len(env_vars) + len(secret_vars)} variables")
    print(f"# Regular vars: {len(env_vars)}, Secrets: {len(secret_vars)}")
    
    # Export as arrays (bash will eval this)
    for key, value in env_vars.items():
        # Escape single quotes in value
        safe_value = value.replace("'", "'\\''")
        print(f"ENV_VARS['{key}']='{safe_value}'")
    
    for key, value in secret_vars.items():
        safe_value = value.replace("'", "'\\''")
        print(f"SECRET_VARS['{key}']='{safe_value}'")
