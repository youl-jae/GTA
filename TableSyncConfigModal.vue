<template>
  <div>

    <b-modal
      id="table-sync-config-modal"
      title="Table Sync Config"
      size="lg"
      @show="loadTableSyncConfig"
    >

      <b-table
        small
        bordered
        hover
        :items="tableSyncList"
        :fields="tableFields"
      >

        <template #cell(enabled)="row">

          <b-form-checkbox
            switch
            v-model="row.item.enabled"
          />

        </template>

      </b-table>

      <template #modal-footer>

        <b-button
          size="sm"
          variant="secondary"
          @click="$bvModal.hide('table-sync-config-modal')"
        >
          Cancel
        </b-button>

        <b-button
          size="sm"
          variant="success"
          @click="saveTableSyncConfig"
        >
          Save
        </b-button>

      </template>

    </b-modal>

  </div>
</template>

<script>

export default {

  name: "TableSyncConfigModal",

  data() {

    return {

      tableFields: [
        {
          key: "table",
          label: "Table Name",
        },
        {
          key: "enabled",
          label: "Enabled",
        },
      ],

      tableSyncList: [],
    };
  },

  methods: {

    async loadTableSyncConfig() {

      try {

        const response =
          await this.$http.get(
            "/api/admin/table-sync-config"
          );

        this.tableSyncList =
          response.data;

      } catch (err) {

        console.error(err);

        alert(
          "Table Sync Config load 실패"
        );
      }
    },

    async saveTableSyncConfig() {

      try {

        await this.$http.post(
          "/api/admin/table-sync-config",
          this.tableSyncList
        );

        alert(
          "Table Sync Config 저장 완료"
        );

        this.$bvModal.hide(
          "table-sync-config-modal"
        );

      } catch (err) {

        console.error(err);

        alert(
          "Table Sync Config 저장 실패"
        );
      }
    },
  },
};
</script>