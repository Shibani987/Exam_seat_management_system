from dataclasses import dataclass
import os


@dataclass(frozen=True)
class AdminCredentials:
    """
    Value object for admin login credentials.

    Secrets are NOT hard-coded here; they always come from environment/.env.
    """

    username: str
    password: str


class AppConfig:
    """
    OOP-style gateway for configuration and secrets.

    This centralizes how we read sensitive values so that views and other
    modules do not touch environment variables directly.
    """

    @staticmethod
    def get_admin_credentials() -> AdminCredentials:
        """
        Return admin username/password loaded from environment.

        - In normal deployments these come from .env (loaded in settings).
        - If they are missing, we raise a clear error instead of silently
          falling back to hard-coded credentials.

        This does not change behavior for correctly configured environments,
        but makes misconfiguration fail fast and explicit.
        """
        username = os.getenv("ADMIN_USERNAME")
        password = os.getenv("ADMIN_PASSWORD")

        if not username or not password:
            raise RuntimeError(
                "ADMIN_USERNAME and ADMIN_PASSWORD must be set in environment/.env"
            )

        return AdminCredentials(username=username, password=password)

