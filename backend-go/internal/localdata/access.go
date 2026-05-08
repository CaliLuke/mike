package localdata

type AccessResult struct {
	IsOwner    bool     `json:"is_owner"`
	SharedWith []string `json:"shared_with"`
}

func SingleUserAccess() AccessResult {
	return AccessResult{
		IsOwner:    true,
		SharedWith: []string{},
	}
}

func CreditsAllowed() bool {
	return true
}
