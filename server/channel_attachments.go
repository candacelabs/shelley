package server

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// channelAttachment is the part of messages/wire.Attachment used to save a
// provider's media locally, just like a file uploaded through the composer.
type channelAttachment struct {
	URL      string `json:"url"`
	Filename string `json:"filename"`
}

func (s *Server) channelMessageText(ctx context.Context, ev channelEvent) (text string, err error) {
	if len(ev.Attachments) == 0 {
		return ev.Text, nil
	}
	var paths []string
	defer func() {
		if err != nil {
			for _, path := range paths {
				os.Remove(path)
			}
		}
	}()
	var references []string
	for _, attachment := range ev.Attachments {
		path, err := s.downloadChannelAttachment(ctx, attachment)
		if err != nil {
			return "", fmt.Errorf("download channel attachment: %w", err)
		}
		paths = append(paths, path)
		references = append(references, "["+path+"]")
	}
	text = ev.Text
	if strings.TrimSpace(text) != "" {
		text += "\n\n"
	}
	return text + strings.Join(references, " "), nil
}

func (s *Server) downloadChannelAttachment(ctx context.Context, attachment channelAttachment) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, attachment.URL, nil)
	if err != nil {
		return "", err
	}
	resp, err := s.channelClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("provider returned HTTP %d", resp.StatusCode)
	}
	name := attachment.Filename
	if name == "" {
		name = filepath.Base(req.URL.Path)
	}
	// Reuse the upload size limit and writer, which sanitizes filenames,
	// prevents overwrites, and removes incomplete files on read errors.
	return saveUploadFile(name, http.MaxBytesReader(nil, resp.Body, maxUploadBytes))
}
