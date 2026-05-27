<template>
  <div>
    <!-- 메인 Modal -->
    <b-modal id="modify-input-info" title="Modify Input Info" @ok="onOk">

      <b-form-group label="Server" label-size="sm">
        <div style="display: flex; align-items: center;">

          <b-form-select
            size="sm"
            v-model="localHost"
            :options="localHostOptions"
            style="margin-right: 0.5rem;"
          />

          <div style="display: flex; align-items: center; gap: 6px;">
            <b-button
              size="sm"
              variant="primary"
              @click="addHost"
              :disabled="serverRole === 'SLAVE'"
            >
              Add
            </b-button>

            <b-button size="sm" variant="primary" @click="modifyHost">
              Modify
            </b-button>

            <b-button
              size="sm"
              variant="primary"
              @click="deleteHost"
              :disabled="serverRole === 'SLAVE'"
            >
              Delete
            </b-button>
          </div>

        </div>
      </b-form-group>

    </b-modal>

    <!-- 서버 수정 Modal -->
    <b-modal
      id="modify-host-modal"
      title="Server Setting"
      @ok="onModifyHostOk"
    >

      <b-form-group label="Server Name" label-size="sm">
        <b-form-input
          v-model="modifyName"
          size="sm"
        />
      </b-form-group>

      <b-form-group label="IP Address" label-size="sm">
        <b-form-input
          v-model="modifyIp"
          size="sm"
        />
      </b-form-group>

    </b-modal>
  </div>
</template>

<script>
export default {
  props: {
    host: String,
    hostOptions: Array,

    // 추가
    serverRole: {
      type: String,
      default: "",
    },
  },

  data() {
    return {
      localHost: this.host,

      localHostOptions: JSON.parse(
        JSON.stringify(this.hostOptions)
      ),

      modifyName: "",
      modifyIp: "",

      isAddMode: false,
    };
  },

  watch: {
    host(val) {
      this.localHost = val;
    },

    hostOptions(val) {
      this.localHostOptions = JSON.parse(
        JSON.stringify(val)
      );
    },
  },

  methods: {

    // 메인 Modal OK
    onOk() {

      this.$emit("update", {
        host: this.localHost,
        hostOptions: this.localHostOptions,
      });
    },

    // Host 수정
    modifyHost() {

      const selected = this.localHostOptions.find(
        (h) => h.value === this.localHost
      );

      if (!selected) return;

      // text: "KR01 (192.168.1.7)"
      const match = selected.text.match(
        /^(.+)\s+\((.+)\)$/
      );

      if (match) {
        this.modifyName = match[1];
        this.modifyIp = match[2];
      } else {
        this.modifyName = selected.text;
        this.modifyIp = selected.value;
      }

      this.isAddMode = false;

      this.$bvModal.show("modify-host-modal");
    },

    // Host 추가
    addHost() {

      if (this.serverRole === "SLAVE") {
        return;
      }

      this.modifyName = "";
      this.modifyIp = "";

      this.isAddMode = true;

      this.$bvModal.show("modify-host-modal");
    },

    // Host 삭제
    async deleteHost() {

      if (this.serverRole === "SLAVE") {
        return;
      }

      try {

        await this.$http.delete(
          `/api/admin/allowed-ips/${this.localHost}`
        );

        this.localHostOptions =
          this.localHostOptions.filter(
            (h) =>
              h.value !== this.localHost
          );

        this.localHost =
          this.localHostOptions[0]?.value || "";

      } catch (err) {

        console.error(err);

        alert(
          "Host 삭제 실패"
        );
      }
    },

    // Add / Modify 완료
    async onModifyHostOk() {

      try {

        const payload = {

          ip: this.modifyIp,

          description:
            this.modifyName,
        };

        // ADD
        if (this.isAddMode) {

          await this.$http.post(
            "/api/admin/allowed-ips",
            payload
          );

        }

        // MODIFY
        else {

          await this.$http.put(
            `/api/admin/allowed-ips/${this.localHost}`,
            payload
          );
        }

        const newItem = {

          value: this.modifyIp,

          text:
            `${this.modifyName} (${this.modifyIp})`,
        };

        if (this.isAddMode) {

          this.localHostOptions.push(
            newItem
          );

        } else {

          const index =
            this.localHostOptions.findIndex(
              (h) =>
                h.value === this.localHost
            );

          if (index !== -1) {

            this.$set(
              this.localHostOptions,
              index,
              newItem
            );
          }
        }

        this.localHost =
          newItem.value;

      } catch (err) {

        console.error(err);

        alert(
          "Host 저장 실패"
        );
      }
    },
  },
};
</script>