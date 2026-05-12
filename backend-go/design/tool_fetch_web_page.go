package design

import (
	. "github.com/CaliLuke/loom-mcp/dsl"
	. "github.com/CaliLuke/loom/dsl"
)

var AssistantFetchWebPageArgs = Type("AssistantFetchWebPageArgs", func() {
	Attribute("url", String, "Public HTTP or HTTPS URL to download and simplify")
	Attribute("max_chars", Int, "Optional maximum characters of simplified text to return")
	Example(map[string]any{"url": "https://www.github.careers/careers-home/jobs/5140?lang=en-us", "max_chars": 40000})
})

var AssistantWebPageText = Type("AssistantWebPageText", func() {
	Attribute("url", String, "Final fetched URL after redirects")
	Attribute("title", String, "Extracted page title")
	Attribute("text", String, "Simplified readable page text")
	Attribute("truncated", Boolean, "Whether the simplified text was truncated")
	Attribute("error", String, "Error message when fetching failed")
})

func declareFetchWebPageTool() {
	Tool("fetch_web_page", "Download a public web page and return simplified readable text", func() {
		Args(AssistantFetchWebPageArgs)
		Return(AssistantWebPageText)
	})
}
