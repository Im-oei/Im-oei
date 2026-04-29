const Core = {
  getProfile() {
    return JSON.parse(localStorage.getItem("profile"));
  },
  setProfile(p) {
    localStorage.setItem("profile", JSON.stringify(p));
  },
  setRole(r) {
    localStorage.setItem("role", r || "");
  },
  getRole() {
    return localStorage.getItem("role");
  },
  requireAdmin() {
    if (!this.getRole()) {
      location.href = "login.html";
    }
  },
  logout() {
    localStorage.clear();
    location.href = "login.html";
  }
};
