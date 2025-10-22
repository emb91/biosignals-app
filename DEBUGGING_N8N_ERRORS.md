# Debugging n8n Analysis Errors

## Common Issues and Solutions

### Issue: "Analysis service failed: 500"

This means n8n returned an error. Common causes:

#### 1. **Claude API Rate Limits**
- **Problem**: Claude.ai has rate limits (HTTP 429) or quota limits
- **Solution**: 
  - Check Claude API dashboard for rate limit status
  - Add retry logic with exponential backoff in n8n
  - Use lower tier models for testing
  - Consider caching results

#### 2. **Website Access Issues**
- **Problem**: Some websites block scraping or have strict rate limits
- **Solution**:
  - Add User-Agent headers in n8n HTTP requests
  - Add delays between requests
  - Use alternative data sources for known problematic sites

#### 3. **Timeout Issues**
- **Problem**: Analysis takes too long (> 5 minutes)
- **Current timeout**: 5 minutes (300000ms)
- **Solution**:
  - Optimize n8n workflow
  - Process in smaller chunks
  - Consider async processing with webhooks

#### 4. **n8n Workflow Errors**
- **Problem**: Error in n8n workflow logic
- **Check**: n8n execution logs
- **Solution**: Test workflow with problematic website in n8n UI

### Issue: "Invalid response from analysis service"

This means the response structure is unexpected.

#### What to Check:
1. **Check Next.js logs** for console.log output:
   ```
   Raw n8n response: {...}
   Found data in rawData[0].message.content (or other location)
   ```

2. **Verify n8n output format**:
   - Should be array with objects
   - Common formats supported:
     - `[{ message: { content: {...} } }]`
     - `[{ json: {...} }]`
     - `[{...}]`
     - `{...}` (single object)

3. **Check if response is empty**:
   - n8n might complete but return no data
   - Check n8n execution logs

### Debugging Steps

#### 1. Check Next.js Console Logs
When you analyze a company, check your terminal for:
```
Calling n8n webhook: http://localhost:5678/webhook/company-analysis
Payload: { website: 'example.com' }
Raw n8n response: {...}
```

#### 2. Test n8n Directly
```bash
curl -X POST http://localhost:5678/webhook/company-analysis \
  -H "Content-Type: application/json" \
  -d '{"website": "claude.ai"}' \
  -v
```

#### 3. Check n8n Execution Logs
- Open n8n UI: http://localhost:5678
- Go to "Executions" tab
- Check failed executions
- Look for error messages

#### 4. Common n8n Workflow Issues

**Issue**: Claude API returns error
```
Error: 429 Too Many Requests
```
**Solution**: Add rate limiting in n8n workflow

**Issue**: Website scraping fails
```
Error: 403 Forbidden
```
**Solution**: Add proper headers, User-Agent

**Issue**: Timeout
```
Error: Request timeout
```
**Solution**: Reduce scope of analysis, optimize workflow

### Response Format Examples

#### Expected Format (Current):
```json
[
  {
    "message": {
      "content": {
        "company_name": "Example Corp",
        "industry": "Technology",
        ...
      }
    }
  }
]
```

#### Alternative Formats (Also Supported):
```json
// Format 1: n8n json output
[{ "json": { "company_name": "..." } }]

// Format 2: Direct array
[{ "company_name": "..." }]

// Format 3: Single object
{ "company_name": "..." }
```

### Environment Variables

Make sure these are set in `.env.local`:
```env
N8N_COMPANY_ANALYSIS_WEBHOOK=http://localhost:5678/webhook/company-analysis
NEXT_PUBLIC_FIREBASE_API_KEY=...
# ... other vars
```

### Production Considerations

1. **Use production n8n URL** (not localhost)
2. **Add authentication** to n8n webhook
3. **Implement retry logic** for transient failures
4. **Add monitoring/alerting** for n8n failures
5. **Consider async processing** for long-running analyses
6. **Cache results** to reduce API calls

### Quick Fixes

#### Problem: Works for some companies, fails for others

**Likely cause**: Rate limits or website-specific issues

**Quick fix**:
1. Check which companies are failing (pattern?)
2. Test those companies directly in n8n
3. Add error handling for specific cases
4. Implement retry with backoff

#### Problem: n8n returns 500 error

**Quick check**:
```bash
# Check if n8n is running
curl http://localhost:5678

# Check workflow status
# Open http://localhost:5678 in browser
```

**Troubleshooting**:
1. Restart n8n: `n8n restart`
2. Check n8n logs
3. Test workflow manually in n8n UI
4. Check Claude API credits/quota

### Contact Support

If issues persist, collect this info:
- Next.js console logs (from terminal)
- n8n execution logs
- Specific website that's failing
- Error message from frontend
- Response from `curl` test (if any)

