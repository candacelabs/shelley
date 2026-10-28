package server

import (
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"shelley.exe.dev/db"
	"shelley.exe.dev/modelproviders"
)

func (s *Server) handleListModelProviders(w http.ResponseWriter, r *http.Request) {
	if s.modelProviders == nil {
		writeJSON(w, http.StatusOK, []modelproviders.Connection{})
		return
	}
	connections, err := s.modelProviders.List(r.Context())
	if err != nil {
		s.writeModelProviderError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, connections)
}

func (s *Server) handleCheckModelProvider(w http.ResponseWriter, r *http.Request) {
	if s.modelProviders == nil {
		http.Error(w, "model provider management is disabled", http.StatusServiceUnavailable)
		return
	}
	input, err := decodeModelProviderInput(w, r)
	if err != nil {
		http.Error(w, "invalid model provider request", http.StatusBadRequest)
		return
	}
	models, err := s.modelProviders.Check(r.Context(), r.PathValue("id"), input)
	if err != nil {
		s.writeModelProviderError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models)
}

func (s *Server) handleCreateModelProvider(w http.ResponseWriter, r *http.Request) {
	if s.modelProviders == nil {
		http.Error(w, "model provider management is disabled", http.StatusServiceUnavailable)
		return
	}
	input, err := decodeModelProviderInput(w, r)
	if err != nil {
		http.Error(w, "invalid model provider request", http.StatusBadRequest)
		return
	}
	connection, err := s.modelProviders.Create(r.Context(), input)
	if err != nil {
		s.writeModelProviderError(w, err)
		return
	}
	s.notifyModelsChanged()
	writeJSON(w, http.StatusCreated, connection)
}

func (s *Server) handleUpdateModelProvider(w http.ResponseWriter, r *http.Request) {
	if s.modelProviders == nil {
		http.Error(w, "model provider management is disabled", http.StatusServiceUnavailable)
		return
	}
	input, err := decodeModelProviderInput(w, r)
	if err != nil {
		http.Error(w, "invalid model provider request", http.StatusBadRequest)
		return
	}
	connection, err := s.modelProviders.Update(r.Context(), r.PathValue("id"), input)
	if err != nil {
		s.writeModelProviderError(w, err)
		return
	}
	s.notifyModelsChanged()
	writeJSON(w, http.StatusOK, connection)
}

func (s *Server) handleRefreshModelProvider(w http.ResponseWriter, r *http.Request) {
	if s.modelProviders == nil {
		http.Error(w, "model provider management is disabled", http.StatusServiceUnavailable)
		return
	}
	connection, err := s.modelProviders.Refresh(r.Context(), r.PathValue("id"))
	if err != nil {
		s.writeModelProviderError(w, err)
		return
	}
	s.notifyModelsChanged()
	writeJSON(w, http.StatusOK, connection)
}

func (s *Server) handleDeleteModelProvider(w http.ResponseWriter, r *http.Request) {
	if s.modelProviders == nil {
		http.Error(w, "model provider management is disabled", http.StatusServiceUnavailable)
		return
	}
	if err := s.modelProviders.Delete(r.Context(), r.PathValue("id")); err != nil {
		s.writeModelProviderError(w, err)
		return
	}
	s.notifyModelsChanged()
	w.WriteHeader(http.StatusNoContent)
}

func decodeModelProviderInput(w http.ResponseWriter, r *http.Request) (modelproviders.Input, error) {
	var input modelproviders.Input
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		return input, err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return input, errors.New("request must contain one JSON value")
	}
	return input, nil
}

func (s *Server) writeModelProviderError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	message := "model provider operation failed"
	switch {
	case errors.Is(err, modelproviders.ErrInvalid):
		status, message = http.StatusBadRequest, err.Error()
	case errors.Is(err, modelproviders.ErrNotFound), errors.Is(err, sql.ErrNoRows):
		status, message = http.StatusNotFound, "model provider not found"
	case errors.Is(err, modelproviders.ErrDuplicate), errors.Is(err, modelproviders.ErrConflict), errors.Is(err, db.ErrProviderConflict):
		status, message = http.StatusConflict, err.Error()
	case errors.Is(err, modelproviders.ErrDiscovery):
		status, message = http.StatusBadGateway, err.Error()
	default:
		s.logger.Error("Model provider operation failed", "error", err)
		status = s.errorStatus(err)
	}
	http.Error(w, message, status)
}
