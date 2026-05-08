package localapi

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"strings"
)

func displayBytes(filename string, data []byte) ([]byte, string) {
	ext := strings.ToLower(filepath.Ext(filename))
	switch ext {
	case ".txt", ".md", ".csv", ".json":
		return data, "text/plain; charset=utf-8"
	case ".docx":
		if text, err := extractDocxText(data); err == nil && strings.TrimSpace(text) != "" {
			return []byte(text), "text/plain; charset=utf-8"
		}
	}
	return data, "application/octet-stream"
}

func extractDocxText(data []byte) (string, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", err
	}
	for _, file := range reader.File {
		if file.Name != "word/document.xml" {
			continue
		}
		rc, err := file.Open()
		if err != nil {
			return "", err
		}
		defer func() { _ = rc.Close() }()
		return textFromWordXML(rc)
	}
	return "", fmt.Errorf("word/document.xml not found")
}

func textFromWordXML(reader io.Reader) (string, error) {
	decoder := xml.NewDecoder(reader)
	var out strings.Builder
	for {
		token, err := decoder.Token()
		if errors.Is(err, io.EOF) {
			return out.String(), nil
		}
		if err != nil {
			return "", err
		}
		switch value := token.(type) {
		case xml.StartElement:
			if value.Name.Local == "p" && out.Len() > 0 {
				out.WriteByte('\n')
			}
		case xml.CharData:
			text := string(value)
			if strings.TrimSpace(text) != "" {
				out.WriteString(text)
			}
		}
	}
}

func applyTrackedChange(data []byte, accept bool) ([]byte, bool, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return data, false, err
	}
	buf := &bytes.Buffer{}
	writer := zip.NewWriter(buf)
	changed := false
	for _, file := range reader.File {
		rc, err := file.Open()
		if err != nil {
			_ = writer.Close()
			return nil, false, err
		}
		content, err := io.ReadAll(rc)
		_ = rc.Close()
		if err != nil {
			_ = writer.Close()
			return nil, false, err
		}
		if file.Name == "word/document.xml" {
			next := rewriteTrackedChangeXML(string(content), accept)
			if next != string(content) {
				changed = true
				content = []byte(next)
			}
		}
		header := file.FileHeader
		out, err := writer.CreateHeader(&header)
		if err != nil {
			_ = writer.Close()
			return nil, false, err
		}
		if _, err := out.Write(content); err != nil {
			_ = writer.Close()
			return nil, false, err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, false, err
	}
	if !changed {
		return data, false, nil
	}
	return buf.Bytes(), true, nil
}

func rewriteTrackedChangeXML(input string, accept bool) string {
	decoder := xml.NewDecoder(strings.NewReader(input))
	out := &bytes.Buffer{}
	encoder := xml.NewEncoder(out)
	skipDepth := 0
	changed := false

	for {
		token, err := decoder.Token()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return input
		}
		if skipDepth > 0 {
			switch token.(type) {
			case xml.StartElement:
				skipDepth++
			case xml.EndElement:
				skipDepth--
			}
			continue
		}
		switch value := token.(type) {
		case xml.StartElement:
			switch value.Name.Local {
			case "del":
				changed = true
				if accept {
					skipDepth = 1
				}
				continue
			case "ins":
				changed = true
				if !accept {
					skipDepth = 1
				}
				continue
			case "delText":
				changed = true
				value.Name.Local = "t"
			}
			if err := encoder.EncodeToken(value); err != nil {
				return input
			}
		case xml.EndElement:
			switch value.Name.Local {
			case "del", "ins":
				changed = true
				continue
			case "delText":
				changed = true
				value.Name.Local = "t"
			}
			if err := encoder.EncodeToken(value); err != nil {
				return input
			}
		default:
			if err := encoder.EncodeToken(token); err != nil {
				return input
			}
		}
	}
	if err := encoder.Flush(); err != nil || !changed {
		return input
	}
	return out.String()
}
