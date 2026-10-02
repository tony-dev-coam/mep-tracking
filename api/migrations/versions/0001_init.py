revision = "0001"
down_revision = None

from alembic import op


def upgrade():
    op.execute("""
    CREATE TABLE projects (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name        text NOT NULL UNIQUE,
      created_at  timestamptz NOT NULL DEFAULT now()
    );

    CREATE TYPE model_status AS ENUM ('processing', 'processed', 'failed');

    CREATE TABLE ifc_models (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      version       int  NOT NULL,
      filename      text NOT NULL,
      ifc_schema    text,
      status        model_status NOT NULL DEFAULT 'processing',
      error         text,
      element_count int,
      validation    jsonb,
      uploaded_at   timestamptz NOT NULL DEFAULT now(),
      processed_at  timestamptz,
      UNIQUE (project_id, version)
    );

    CREATE TABLE ifc_elements (
      id                 bigserial PRIMARY KEY,
      model_id           uuid NOT NULL REFERENCES ifc_models(id) ON DELETE CASCADE,
      global_id          text NOT NULL,
      express_id         int  NOT NULL,
      ifc_type           text NOT NULL,
      name               text,
      object_type        text,
      tag                text,
      parent_global_id   text,
      storey_global_id   text,
      is_spatial         bool NOT NULL,
      is_equipment       bool NOT NULL,
      has_geometry       bool NOT NULL,
      properties         jsonb NOT NULL DEFAULT '{}',
      materials          jsonb NOT NULL DEFAULT '[]',
      UNIQUE (model_id, global_id)
    );
    CREATE INDEX ON ifc_elements (model_id, is_equipment);
    CREATE INDEX ON ifc_elements (model_id, storey_global_id);
    CREATE INDEX ON ifc_elements (model_id, parent_global_id);
    CREATE INDEX ON ifc_elements USING gin (properties);
    """)


def downgrade():
    op.execute("DROP TABLE ifc_elements, ifc_models, projects; DROP TYPE model_status;")
