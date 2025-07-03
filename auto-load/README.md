# Restfox Auto-Loading Feature

This feature allows Restfox to automatically pre-load collections and environments from local files when the application starts up.

## How It Works

When a workspace is loaded, Restfox checks the configuration in `constants.ts` and attempts to read the specified files. If the files exist and are valid, they are automatically imported into the current workspace.

## Configuration

The auto-loading behavior is configured in `packages/ui/src/constants.ts` under the `AUTO_LOAD` section:

```typescript
AUTO_LOAD: {
    // Enable or disable auto-loading
    ENABLED: true,
    
    FILES: {
        // Collection files to auto-load
        COLLECTIONS: [
            './auto-load/collections.json',
            './auto-load/api-collection.json'
        ],
        // Environment files to auto-load  
        ENVIRONMENTS: [
            './auto-load/environments.json',
            './auto-load/dev-environment.json'
        ]
    },
    
    // Options
    SKIP_ON_EXISTING_DATA: true,      // Skip if workspace already has collections
    MERGE_ENVIRONMENTS: true,         // Whether to merge or replace environments
    DEFAULT_IMPORT_TYPE: 'Restfox'    // Default import format
}
```

## Supported File Formats

The auto-loading feature supports the same formats as the regular import functionality:

- **Restfox** (`.json`) - Native Restfox export format
- **Postman** (`.json`) - Postman collection v2.0/v2.1 format  
- **Insomnia** (`.json`) - Insomnia/Insomnium export format
- **OpenAPI** (`.json`, `.yml`, `.yaml`) - OpenAPI/Swagger specification

## File Structure

### Collection Files

Collection files should follow the format of the respective tool. For Restfox format, see `collections.json` as an example.

### Environment Files

Environment files can be either:

1. **Array format** (recommended for standalone environment files):
```json
[
    {
        "name": "Development",
        "environment": { "key": "value" },
        "color": "#4CAF50"
    }
]
```

2. **Single environment object**:
```json
{
    "name": "Production", 
    "environment": { "key": "value" },
    "color": "#FF5722"
}
```

## Platform Support

- **Electron App**: Full support for reading local files
- **Web Browser**: Not supported (requires file system access)
- **Web Standalone**: Not supported

## Usage

1. **Configure file paths** in `constants.ts` to point to your collection and environment files
2. **Place your files** in the specified locations (relative to the app root)
3. **Start Restfox** - the files will be automatically loaded when a workspace loads
4. **Check console output** for auto-loading status and any errors

## Example Files

This directory contains example files:

- `collections.json` - Example Restfox collection with API requests
- `environments.json` - Example environment configurations

## Troubleshooting

### Auto-loading not working

1. Check that `AUTO_LOAD.ENABLED` is `true` in constants.ts
2. Verify file paths are correct and files exist
3. Check browser/Electron console for error messages
4. Ensure you're using the Electron app (web browser doesn't support file system access)

### Files not found

- File paths are relative to the application root
- Use forward slashes (`/`) in paths, even on Windows
- Check file permissions and accessibility

### Import errors

- Verify file format matches the `DEFAULT_IMPORT_TYPE` setting
- Check that JSON files are valid JSON
- Review file content matches expected schema for the format

## Security Considerations

- Only files accessible to the Electron app can be read
- File paths are not validated for security, so use trusted paths only
- Environment files may contain sensitive data - store securely

## Performance

- Auto-loading happens during workspace initialization
- Large collections may increase startup time
- Consider using `SKIP_ON_EXISTING_DATA: true` to avoid unnecessary processing 