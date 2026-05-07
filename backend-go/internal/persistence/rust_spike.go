package persistence

/*
#cgo darwin LDFLAGS: -lluke_surreal_bridge -framework IOKit
#cgo !darwin LDFLAGS: -lluke_surreal_bridge
#include <stdlib.h>

int luke_surreal_persistence_spike(const char *path, char *err_buf, unsigned long err_len);
*/
import "C"

import (
	"fmt"
	"unsafe"
)

func RunSurrealKVSpike(path string) error {
	cPath := C.CString(path)
	defer C.free(unsafe.Pointer(cPath))

	const errLen = 4096
	errBuf := (*C.char)(C.malloc(errLen))
	defer C.free(unsafe.Pointer(errBuf))

	rc := C.luke_surreal_persistence_spike(cPath, errBuf, errLen)
	if rc == 0 {
		return nil
	}
	return fmt.Errorf("rust surrealdb spike failed: %s", C.GoString(errBuf))
}
