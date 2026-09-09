"""Alembic environment.

Pulls the URL from application settings (so there is exactly one source of
truth) and targets ``Base.metadata`` so future model changes are detected by
``alembic revision --autogenerate``.
"""

from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.core.config import settings
from app.core.database import Base

# Importing the models package registers every table on Base.metadata.
# It is empty today; Step 3 fills it in.
import app.models  # noqa: F401

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Injected at runtime — never written into alembic.ini.
config.set_main_option("sqlalchemy.url", settings.database_url)

target_metadata = Base.metadata


# Objects created by raw SQL in a migration rather than declared on a model.
# Autogenerate cannot see them in the metadata and would emit a DROP for each
# one on the next revision, so they are filtered out here.
EXTERNALLY_MANAGED_INDEXES = {
    # GIN trigram index for fuzzy patient-name search; created conditionally in
    # the initial migration, since it depends on the pg_trgm extension.
    "ix_patients_name_trgm",
}


def _include_object(obj, name, type_, reflected, compare_to) -> bool:
    """Keep Alembic's attention on our own tables."""
    if type_ == "table" and name in {"spatial_ref_sys"}:
        return False
    if type_ == "index" and name in EXTERNALLY_MANAGED_INDEXES:
        return False
    return True


def run_migrations_offline() -> None:
    """Emit SQL to stdout without a live connection (``alembic upgrade --sql``)."""
    context.configure(
        url=settings.database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
        include_object=_include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations against a real connection."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
            include_object=_include_object,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
